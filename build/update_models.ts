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
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

// Provider prefix → license/provider mapping (order matters: more specific first)
const LICENSE_MAP = [
  { prefix: 'google/gemma', license: 'open-weights', provider: 'Google' },
  { prefix: 'microsoft/phi', license: 'open-source', provider: 'Microsoft' },
  { prefix: 'anthropic/', license: 'commercial', provider: 'Anthropic' },
  { prefix: 'openai/', license: 'commercial', provider: 'OpenAI' },
  { prefix: 'x-ai/', license: 'commercial', provider: 'xAI' },
  { prefix: 'google/', license: 'commercial', provider: 'Google' },
  { prefix: 'meta-llama/', license: 'open-weights', provider: 'Meta' },
  { prefix: 'mistralai/', license: 'open-weights', provider: 'Mistral' },
  { prefix: 'deepseek/', license: 'open-source', provider: 'DeepSeek' },
  { prefix: 'qwen/', license: 'open-source', provider: 'Alibaba' },
  { prefix: 'nvidia/', license: 'open-source', provider: 'NVIDIA' },
  { prefix: 'cohere/', license: 'open-source', provider: 'Cohere' },
] as const;

const ALLOWED_PREFIXES = [...new Set(LICENSE_MAP.map((m) => m.prefix.split('/')[0] + '/'))];

interface ORModel {
  id: string;
  name: string;
  created?: number;
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

function getLicenseInfo(modelId: string): { license: string; provider: string } | null {
  for (const entry of LICENSE_MAP) {
    if (modelId.startsWith(entry.prefix)) {
      return { license: entry.license, provider: entry.provider };
    }
  }
  return null;
}

function isAllowedModel(modelId: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => modelId.startsWith(prefix));
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

  const drops = { prefix: 0, variant: 0, old: 0, nonText: 0, idMatch: 0, nameMatch: 0, noLicense: 0 };
  const newModels: ModelYaml[] = [];

  for (const candidate of allModels) {
    if (!isAllowedModel(candidate.id)) { drops.prefix++; continue; }
    if (candidate.id.includes(':')) { drops.variant++; continue; }
    if (!isRecent(candidate, cutoff)) { drops.old++; continue; }
    if (!isTextOnly(candidate)) { drops.nonText++; continue; }
    if (existingIds.has(candidate.id)) { drops.idMatch++; continue; }

    const licenseInfo = getLicenseInfo(candidate.id);
    if (!licenseInfo) { drops.noLicense++; continue; }

    const derivedName = deriveModelName(candidate.id, candidate.name);
    if (existingNames.has(normalizeName(derivedName))) { drops.nameMatch++; continue; }

    newModels.push({
      id: candidate.id,
      name: derivedName,
      provider: licenseInfo.provider,
      license: licenseInfo.license,
      released: formatReleased(candidate.created!),
    });
  }

  console.log(
    `  Filter drops: prefix=${drops.prefix} variant=${drops.variant} ` +
      `older-than-30d=${drops.old} non-text=${drops.nonText} ` +
      `id-match=${drops.idMatch} name-match=${drops.nameMatch} no-license=${drops.noLicense}`,
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
