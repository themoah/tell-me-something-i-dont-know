#!/usr/bin/env tsx
/**
 * Re-run topic detection on all responses in site/data.json and refresh stats.
 * No API calls.
 *
 * Usage: npm run retag
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { retagData, type ModelEntry, type TopicStats } from './query_models.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'site', 'data.json');

interface DataFile {
  meta: Record<string, unknown>;
  stats: TopicStats;
  models: ModelEntry[];
}

async function main() {
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as DataFile;
  const stats = retagData(data);
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Retagged ${stats.total_models} models, ${stats.total_responses} responses`);
  console.log('Top topics:', JSON.stringify(stats.topic_frequency, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
