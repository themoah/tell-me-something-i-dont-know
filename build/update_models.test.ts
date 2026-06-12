import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLicenseString,
  deriveProvider,
  bumpPatch,
  isRedundantVariant,
} from './update_models.ts';

test('classifyLicenseString: apache-2.0 → open-source', () => {
  assert.equal(classifyLicenseString('apache-2.0'), 'open-source');
});

test('classifyLicenseString: MIT (uppercase) → open-source', () => {
  assert.equal(classifyLicenseString('MIT'), 'open-source');
});

test('classifyLicenseString: bsd-3-clause → open-source', () => {
  assert.equal(classifyLicenseString('bsd-3-clause'), 'open-source');
});

test('classifyLicenseString: llama3.3 → open-weights', () => {
  assert.equal(classifyLicenseString('llama3.3'), 'open-weights');
});

test('classifyLicenseString: gemma → open-weights', () => {
  assert.equal(classifyLicenseString('gemma'), 'open-weights');
});

test('classifyLicenseString: cc-by-nc-4.0 → open-weights', () => {
  assert.equal(classifyLicenseString('cc-by-nc-4.0'), 'open-weights');
});

test('classifyLicenseString: "other" → open-weights', () => {
  assert.equal(classifyLicenseString('other'), 'open-weights');
});

test('classifyLicenseString: null → open-weights (safer bucket)', () => {
  assert.equal(classifyLicenseString(null), 'open-weights');
});

test('classifyLicenseString: empty string → open-weights', () => {
  assert.equal(classifyLicenseString(''), 'open-weights');
});

test('deriveProvider: canonical anthropic', () => {
  assert.equal(deriveProvider('anthropic/claude-sonnet-4.6'), 'Anthropic');
});

test('deriveProvider: canonical x-ai → xAI', () => {
  assert.equal(deriveProvider('x-ai/grok-4'), 'xAI');
});

test('deriveProvider: canonical meta-llama → Meta', () => {
  assert.equal(deriveProvider('meta-llama/llama-3.3-70b'), 'Meta');
});

test('deriveProvider: unknown prefix gets title-cased', () => {
  assert.equal(deriveProvider('perceptron/mk1'), 'Perceptron');
});

test('deriveProvider: hyphenated unknown prefix gets title-cased per word', () => {
  assert.equal(deriveProvider('inception-labs/model'), 'Inception Labs');
});

test('bumpPatch: 1.0.25 → 1.0.26', () => {
  assert.equal(bumpPatch('1.0.25'), '1.0.26');
});

test('bumpPatch: rolls over patch only (no minor/major bump)', () => {
  assert.equal(bumpPatch('2.3.99'), '2.3.100');
});

test('bumpPatch: trims whitespace', () => {
  assert.equal(bumpPatch('  1.0.0  '), '1.0.1');
});

test('bumpPatch: throws on invalid semver', () => {
  assert.throws(() => bumpPatch('1.0'), /Invalid semver/);
  assert.throws(() => bumpPatch('1.0.0-beta'), /Invalid semver/);
  assert.throws(() => bumpPatch(''), /Invalid semver/);
});

test('isRedundantVariant: variant with base present → redundant', () => {
  const ids = new Set(['qwen/qwen3-instruct', 'qwen/qwen3-instruct:free']);
  assert.equal(isRedundantVariant('qwen/qwen3-instruct:free', ids), true);
});

test('isRedundantVariant: variant-only model (no base) → kept', () => {
  const ids = new Set(['nex-agi/nex-n2-pro:free']);
  assert.equal(isRedundantVariant('nex-agi/nex-n2-pro:free', ids), false);
});

test('isRedundantVariant: plain id (no colon) → not a variant', () => {
  const ids = new Set(['anthropic/claude-sonnet-4.6']);
  assert.equal(isRedundantVariant('anthropic/claude-sonnet-4.6', ids), false);
});
