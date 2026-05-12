#!/usr/bin/env tsx
import 'dotenv/config';
/**
 * Auto-discover new popular models from OpenRouter and add them to models.yaml.
 * Never removes or modifies existing models — only appends new ones.
 *
 * Filters:
 *   - Only models with `created` within the last 30 days
 *   - Only text-in / text-out models (drops image-gen, audio/TTS, etc.)
 *   - Dedup by both ID and normalized name
 *
 * Usage:
 *   export OPENROUTER_API_KEY="sk-or-..."
 *   npm run update-models
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_YAML = path.join(__dirname, 'models.yaml');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

export type License = 'commercial' | 'open-weights' | 'open-source';

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'x-ai': 'xAI',
  google: 'Google',
  'meta-llama': 'Meta',
  mistralai: 'Mistral',
  deepseek: 'DeepSeek',
  qwen: 'Alibaba',
  nvidia: 'NVIDIA',
  cohere: 'Cohere',
  microsoft: 'Microsoft',
};

const OSI_LICENSE_RE = /^(apache|mit|bsd|isc|mpl|gpl|lgpl|agpl|unlicense|cc0|epl|zlib)(-|$)/;

export function classifyLicenseString(raw: string | null | undefined): License {
  if (!raw) return 'open-weights';
  const s = raw.toLowerCase().trim();
  if (!s) return 'open-weights';
  if (OSI_LICENSE_RE.test(s)) return 'open-source';
  return 'open-weights';
}

export function deriveProvider(modelId: string): string {
  const prefix = modelId.split('/')[0] ?? modelId;
  if (PROVIDER_NAMES[prefix]) return PROVIDER_NAMES[prefix];
  return prefix
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchHfLicense(
  hfId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(hfId)) return cache.get(hfId)!;
  try {
    const resp = await fetch(`https://huggingface.co/api/models/${hfId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      cache.set(hfId, null);
      return null;
    }
    const d = (await resp.json()) as { cardData?: { license?: string } };
    const lic = d.cardData?.license ?? null;
    cache.set(hfId, lic);
    return lic;
  } catch {
    cache.set(hfId, null);
    return null;
  }
}

export async function classifyModel(
  model: { id: string; hugging_face_id?: string | null },
  cache: Map<string, string | null>,
): Promise<License> {
  const hf = model.hugging_face_id;
  if (!hf) return 'commercial';
  const lic = await fetchHfLicense(hf, cache);
  return classifyLicenseString(lic);
}

interface ORModel {
  id: string;
  name: string;
  created?: number;
  hugging_face_id?: string | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
}

interface ModelYaml {
  id: string;
  name: string;
  provider: string;
  license: string;
  released: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatReleased(createdSec: number): string {
  const d = new Date(createdSec * 1000);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface Config {
  prompt: string;
  temperature: number;
  max_tokens: number;
  runs_per_model: number;
  models: ModelYaml[];
}

function deriveModelName(modelId: string, apiName: string | undefined): string {
  if (apiName?.trim()) return apiName.trim();
  const idPart = modelId.split('/')[1] ?? modelId;
  return idPart
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) throw new Error(`Invalid semver patch version: ${version}`);
  const [, major, minor, patch] = m;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

async function bumpPackageVersion(): Promise<{ from: string; to: string }> {
  const raw = await fs.readFile(PACKAGE_JSON, 'utf-8');
  const pkg = JSON.parse(raw) as { version: string };
  const from = pkg.version;
  const to = bumpPatch(from);
  const updated = raw.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_, l, r) => `${l}${to}${r}`,
  );
  await fs.writeFile(PACKAGE_JSON, updated, 'utf-8');
  return { from, to };
}

export function hasLatestToken(id: string): boolean {
  const slashIdx = id.indexOf('/');
  const slug = slashIdx < 0 ? id : id.slice(slashIdx + 1);
  return slug
    .split('-')
    .some((part) => part.toLowerCase() === 'latest');
}

export function stripFastSuffix(id: string): string {
  const slashIdx = id.indexOf('/');
  if (slashIdx < 0) return id;
  const prefix = id.slice(0, slashIdx);
  const slug = id.slice(slashIdx + 1);
  if (!slug) return id;
  const stripped = slug
    .split('-')
    .filter((part) => part.toLowerCase() !== 'fast')
    .join('-');
  return `${prefix}/${stripped}`;
}

function isRecent(m: ORModel, cutoff: number): boolean {
  return typeof m.created === 'number' && m.created >= cutoff;
}

function isTextOnly(m: ORModel): boolean {
  const inMods = m.architecture?.input_modalities;
  const outMods = m.architecture?.output_modalities;
  if (!inMods || !outMods) return false;
  return inMods.includes('text') && outMods.includes('text');
}

async function getAllModels(apiKey: string): Promise<ORModel[]> {
  const resp = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch models list: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { data?: ORModel[] };
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? '',
    created: m.created,
    hugging_face_id: m.hugging_face_id ?? null,
    architecture: m.architecture,
  }));
}

async function appendModelsToYaml(newModels: ModelYaml[]): Promise<void> {
  let existing = await fs.readFile(MODELS_YAML, 'utf-8');
  if (!existing.endsWith('\n')) existing += '\n';

  const byLicense: Record<string, ModelYaml[]> = {};
  for (const m of newModels) {
    (byLicense[m.license] ??= []).push(m);
  }

  let additions = '\n  # === Auto-discovered models ===\n';
  for (const models of Object.values(byLicense)) {
    for (const m of models) {
      additions += `  - id: "${m.id}"\n`;
      additions += `    name: "${m.name}"\n`;
      additions += `    provider: "${m.provider}"\n`;
      additions += `    license: "${m.license}"\n`;
      additions += `    released: "${m.released}"\n`;
      additions += '\n';
    }
  }

  await fs.writeFile(MODELS_YAML, existing + additions, 'utf-8');
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('ERROR: Set OPENROUTER_API_KEY environment variable');
    process.exit(1);
  }

  console.log('Fetching all models from OpenRouter API...');
  const allModels = await getAllModels(apiKey);
  console.log(`  Found ${allModels.length} total models`);

  const yamlContent = await fs.readFile(MODELS_YAML, 'utf-8');
  const config = yaml.load(yamlContent) as Config;
  const existingIds = new Set(config.models.map((m) => m.id));
  const existingNames = new Set(config.models.map((m) => normalizeName(m.name)));
  console.log(`  Existing models in YAML: ${existingIds.size}`);

  const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SEC;

  const drops = { variant: 0, old: 0, nonText: 0, idMatch: 0, nameMatch: 0, fastVariant: 0, latestAlias: 0 };
  const newModels: ModelYaml[] = [];
  const hfCache = new Map<string, string | null>();

  for (const candidate of allModels) {
    if (candidate.id.includes(':')) { drops.variant++; continue; }
    if (hasLatestToken(candidate.id)) { drops.latestAlias++; continue; }
    if (!isRecent(candidate, cutoff)) { drops.old++; continue; }
    if (!isTextOnly(candidate)) { drops.nonText++; continue; }
    if (existingIds.has(candidate.id)) { drops.idMatch++; continue; }

    const baseId = stripFastSuffix(candidate.id);
    if (baseId !== candidate.id && existingIds.has(baseId)) {
      drops.fastVariant++;
      continue;
    }

    const derivedName = deriveModelName(candidate.id, candidate.name);
    if (existingNames.has(normalizeName(derivedName))) { drops.nameMatch++; continue; }

    const license = await classifyModel(candidate, hfCache);

    newModels.push({
      id: candidate.id,
      name: derivedName,
      provider: deriveProvider(candidate.id),
      license,
      released: formatReleased(candidate.created!),
    });
  }

  console.log(
    `  Filter drops: variant=${drops.variant} older-than-30d=${drops.old} ` +
      `non-text=${drops.nonText} id-match=${drops.idMatch} name-match=${drops.nameMatch} ` +
      `fast-variant=${drops.fastVariant} latest-alias=${drops.latestAlias}`,
  );

  if (newModels.length === 0) {
    console.log('\nNo new models found. models.yaml is already up to date.');
    return;
  }

  console.log(`\nNew models to add (${newModels.length}):`);
  for (const m of newModels) {
    console.log(`  + [${m.license.padEnd(12)}] ${m.name} (${m.id})`);
  }

  await appendModelsToYaml(newModels);
  console.log(`\nUpdated build/models.yaml with ${newModels.length} new model(s).`);

  const { from, to } = await bumpPackageVersion();
  console.log(`Bumped package.json version: ${from} → ${to}`);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
