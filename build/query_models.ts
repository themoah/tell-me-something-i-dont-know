#!/usr/bin/env tsx
import 'dotenv/config';
/**
 * Query LLMs via OpenRouter and generate data.json for the static site.
 *
 * Usage:
 *   export OPENROUTER_API_KEY="sk-or-..."
 *   npm run query
 *
 *   # Only query specific models
 *   npm run query -- --filter "claude,gpt"
 *
 *   # Dry run (show what would be queried without calling the API)
 *   npm run query -- --dry-run
 *
 *   # Append to existing data.json (skip already-queried models)
 *   npm run query -- --append
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, '..', 'site');
const DATA_FILE = path.join(SITE_DIR, 'data.json');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  license: string;
  released?: string;
}

interface Config {
  prompt: string;
  temperature: number;
  max_tokens: number;
  runs_per_model: number;
  models: ModelConfig[];
}

interface RunResult {
  success: boolean;
  content: string | null;
  tokens_prompt?: number;
  tokens_completion?: number;
  tokens_reasoning?: number;
  finish_reason?: string;
  topics?: string[];
  reasoning?: string;
  error?: string;
}

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  license: string;
  released?: string;
  runs: RunResult[];
}

async function loadConfig(): Promise<Config> {
  const content = await fs.readFile(path.join(__dirname, 'models.yaml'), 'utf-8');
  return yaml.load(content) as Config;
}

async function queryModel(
  modelId: string,
  prompt: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
): Promise<RunResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://tellmesomethingidontknow.ai',
    'X-Title': "Tell Me Something I Don't Know",
  };

  const payload = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens: maxTokens,
    include_reasoning: true,
  };

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { success: false, content: null, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string; reasoning?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number };
    };

    const content = data.choices[0].message.content;
    const reasoning = data.choices[0].message.reasoning ?? undefined;
    const usage = data.usage ?? {};

    return {
      success: true,
      content,
      tokens_prompt: usage.prompt_tokens ?? 0,
      tokens_completion: usage.completion_tokens ?? 0,
      tokens_reasoning: usage.reasoning_tokens ?? undefined,
      finish_reason: data.choices[0].finish_reason ?? 'unknown',
      ...(reasoning ? { reasoning } : {}),
    };
  } catch (e: unknown) {
    const err = e as Error;
    if (err.name === 'TimeoutError') {
      return { success: false, content: null, error: 'timeout' };
    }
    return { success: false, content: null, error: (err.message ?? String(e)).slice(0, 200) };
  }
}

function detectTopics(text: string): string[] {
  const lower = text.toLowerCase();

  const topicKeywords: Record<string, string[]> = {
    jellyfish: ['jellyfish', 'medusa', 'cnidarian'],
    octopus: ['octopus', 'octopi', 'octopuses', 'cephalopod'],
    'eiffel tower': ['eiffel tower', 'gustave eiffel'],
    honey: ['honey never spoils', "honey doesn't expire", 'honey found in tombs'],
    bananas: ['bananas are berries', 'banana is a berry', 'banana.*radioactive'],
    cleopatra: ['cleopatra.*pyramid', 'cleopatra.*moon landing', 'cleopatra.*closer in time'],
    'oxford university': ['oxford.*university.*aztec', 'oxford.*older'],
    'mantis shrimp': ['mantis shrimp'],
    tardigrade: ['tardigrade', 'water bear'],
    venus: ['venus.*day.*year', 'venus.*longer'],
    'blue whale': ['blue whale.*heart', 'blue whale.*tongue'],
    shakespeare: ['shakespeare.*invented', 'shakespeare.*words'],
    dna: ['share.*dna.*banana', 'dna.*banana'],
    space: ['neutron star', 'teaspoon.*star', 'space.*silent'],
    platypus: ['platypus'],
    sloths: ['sloth'],
    trees: ['more trees.*stars', 'trees on earth.*stars'],
  'anglo-zanzibar war': ['anglo-zanzibar', 'zanzibar war', 'shortest war', 'shortest recorded war'],
  };

  const topics: string[] = [];
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    for (const kw of keywords) {
      if (new RegExp(kw).test(lower)) {
        topics.push(topic);
        break;
      }
    }
  }
  return topics;
}

function computeStats(models: ModelEntry[]) {
  const topicCounts: Record<string, number> = {};
  let totalResponses = 0;
  let totalTokens = 0;
  let totalReasoningTokens = 0;

  for (const model of models) {
    for (const run of model.runs) {
      if (run.success) {
        totalResponses++;
        totalTokens += run.tokens_completion ?? 0;
        totalReasoningTokens += run.tokens_reasoning ?? 0;
        for (const topic of run.topics ?? []) {
          topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
        }
      }
    }
  }

  const topicFrequency = Object.fromEntries(
    Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20),
  );

  return {
    total_models: models.length,
    total_responses: totalResponses,
    total_tokens: totalTokens,
    total_reasoning_tokens: totalReasoningTokens,
    topic_frequency: topicFrequency,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  let filterStr: string | null = null;
  let dryRun = false;
  let append = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filter' && args[i + 1]) {
      filterStr = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--append') {
      append = true;
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey && !dryRun) {
    console.error('ERROR: Set OPENROUTER_API_KEY environment variable');
    process.exit(1);
  }

  const config = await loadConfig();
  const { prompt, temperature, max_tokens: maxTokens, runs_per_model: runsPerModel = 3 } = config;
  let models = config.models;

  if (filterStr) {
    const filters = filterStr.split(',').map((f) => f.trim().toLowerCase());
    models = models.filter((m) =>
      filters.some((f) => m.id.toLowerCase().includes(f) || m.name.toLowerCase().includes(f)),
    );
  }

  // Load existing data if appending
  const existingIds = new Set<string>();
  let existingData: ModelEntry[] = [];
  if (append) {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf-8');
      const old = JSON.parse(raw) as { models?: ModelEntry[] };
      existingData = old.models ?? [];
      for (const m of existingData) existingIds.add(m.id);
    } catch {
      // no existing file, start fresh
    }
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Querying ${models.length} models × ${runsPerModel} runs`);
  console.log(`Prompt: "${prompt}"`);
  console.log(`Temperature: ${temperature}, Max tokens: ${maxTokens}`);
  console.log('-'.repeat(60));

  if (dryRun) {
    for (const m of models) {
      const status = existingIds.has(m.id) ? '(SKIP - already queried)' : '';
      console.log(`  ${m.name.padEnd(30)} [${m.license.padEnd(12)}] ${m.id} ${status}`);
    }
    return;
  }

  const results: ModelEntry[] = [...existingData];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];

    if (existingIds.has(model.id)) {
      console.log(`[${i + 1}/${models.length}] SKIP ${model.name} (already queried)`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${models.length}] Querying ${model.name}...`);

    const runs: RunResult[] = [];
    for (let runIdx = 0; runIdx < runsPerModel; runIdx++) {
      let result = await queryModel(model.id, prompt, temperature, maxTokens, apiKey!);

      // Retry if model returned success but empty content (e.g. reasoning ate all tokens)
      const retryTokens = [2500, 5000, 10000];
      let retries = 0;
      while (result.success && (!result.content || !result.content.trim()) && retries < retryTokens.length) {
        const boostedTokens = retryTokens[retries];
        retries++;
        process.stdout.write(` ↻(retry ${retries}, max_tokens=${boostedTokens})`);
        await sleep(1000);
        result = await queryModel(model.id, prompt, temperature, boostedTokens, apiKey!);
      }

      if (result.success) {
        result.topics = detectTopics(result.content!);
        process.stdout.write(' ✓');
      } else {
        process.stdout.write(` ✗(${(result.error ?? '').slice(0, 30)})`);
      }

      runs.push(result);

      if (runIdx < runsPerModel - 1) await sleep(1000);
    }

    results.push({
      id: model.id,
      name: model.name,
      provider: model.provider,
      license: model.license,
      ...(model.released ? { released: model.released } : {}),
      runs,
    });

    console.log(); // newline after model
    await sleep(500);
  }

  const stats = computeStats(results);

  const output = {
    meta: {
      prompt,
      temperature,
      max_tokens: maxTokens,
      runs_per_model: runsPerModel,
      generated_at: new Date().toISOString(),
      total_models: stats.total_models,
    },
    stats,
    models: results,
  };

  await fs.mkdir(SITE_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(output, null, 2) + '\n', 'utf-8');

  console.log('-'.repeat(60));
  console.log(`Done! Wrote ${results.length} models to ${DATA_FILE}`);
  console.log(`Total successful responses: ${stats.total_responses}`);
  console.log(`Top topics: ${JSON.stringify(stats.topic_frequency, null, 2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
