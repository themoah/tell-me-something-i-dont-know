#!/usr/bin/env tsx
import 'dotenv/config';
/**
 * Auto-discover new popular models from OpenRouter and add them to models.yaml.
 * Never removes or modifies existing models — only appends new ones.
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
const OPENROUTER_RANKINGS_URL = 'https://openrouter.ai/rankings?view=month';

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

interface ModelYaml {
  id: string;
  name: string;
  provider: string;
  license: string;
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

async function getRankedModelIds(): Promise<string[]> {
  try {
    const resp = await fetch(OPENROUTER_RANKINGS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tell-me-something-i-dont-know-bot/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    // Extract __NEXT_DATA__ from Next.js SSR payload
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
    if (match) {
      const nextData = JSON.parse(match[1]) as Record<string, unknown>;
      const pageProps = (nextData?.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined;

      if (pageProps?.models) {
        return (pageProps.models as Array<Record<string, string>>)
          .map((m) => m.id ?? m.slug)
          .filter(Boolean);
      }
      if (pageProps?.rankings) {
        return (pageProps.rankings as Array<Record<string, string>>)
          .map((m) => m.id ?? m.model_id)
          .filter(Boolean);
      }

      // Fallback: scan JSON for model ID patterns (provider/model-name)
      const ids = JSON.stringify(nextData).match(/"id":"([a-z0-9_-]+\/[a-z0-9._:-]+)"/g);
      if (ids && ids.length > 0) {
        return [...new Set(ids.map((s) => s.replace(/^"id":"/, '').replace(/"$/, '')))];
      }
    }
  } catch (e) {
    console.log(`  Note: could not parse rankings page (${e}), falling back to full model list`);
  }
  return [];
}

async function getAllModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
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
  const data = (await resp.json()) as { data?: Array<{ id: string; name?: string }> };
  return (data.data ?? []).map((m) => ({ id: m.id, name: m.name ?? '' }));
}

async function appendModelsToYaml(newModels: ModelYaml[]): Promise<void> {
  let existing = await fs.readFile(MODELS_YAML, 'utf-8');
  if (!existing.endsWith('\n')) existing += '\n';

  // Group by license for readable output
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

  console.log('Fetching rankings page...');
  const rankedIds = await getRankedModelIds();
  console.log(`  Found ${rankedIds.length} ranked model IDs`);

  // Load existing models.yaml to get known IDs
  const yamlContent = await fs.readFile(MODELS_YAML, 'utf-8');
  const config = yaml.load(yamlContent) as Config;
  const existingIds = new Set(config.models.map((m) => m.id));
  console.log(`  Existing models in YAML: ${existingIds.size}`);

  const modelMap = new Map(allModels.map((m) => [m.id, m.name]));

  // Build candidate list: ranked models first (higher priority), then full list
  const candidates: Array<{ id: string; name: string }> = [];
  const seenIds = new Set<string>();

  for (const id of rankedIds) {
    if (!seenIds.has(id) && isAllowedModel(id)) {
      candidates.push({ id, name: modelMap.get(id) ?? '' });
      seenIds.add(id);
    }
  }
  for (const model of allModels) {
    if (!seenIds.has(model.id) && isAllowedModel(model.id)) {
      candidates.push(model);
      seenIds.add(model.id);
    }
  }

  // Find new models not yet in YAML
  const newModels: ModelYaml[] = [];
  for (const candidate of candidates) {
    if (existingIds.has(candidate.id)) continue;

    // Skip provider-variant suffixes like :free, :extended, :nitro
    if (candidate.id.includes(':')) continue;

    const licenseInfo = getLicenseInfo(candidate.id);
    if (!licenseInfo) continue;

    newModels.push({
      id: candidate.id,
      name: deriveModelName(candidate.id, candidate.name),
      provider: licenseInfo.provider,
      license: licenseInfo.license,
    });
  }

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
