import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripFastSuffix,
  classifyLicenseString,
  deriveProvider,
  hasLatestToken,
  bumpPatch,
} from './update_models.ts';

test('strips -fast suffix', () => {
  assert.equal(stripFastSuffix('x-ai/grok-4.1-fast'), 'x-ai/grok-4.1');
});

test('strips -fast- in middle of slug', () => {
  assert.equal(stripFastSuffix('x-ai/grok-4.1-fast-mini'), 'x-ai/grok-4.1-mini');
});

test('is case-insensitive for the token', () => {
  assert.equal(stripFastSuffix('x-ai/GROK-4.1-FAST'), 'x-ai/GROK-4.1');
});

test('returns id unchanged when no fast token', () => {
  assert.equal(stripFastSuffix('x-ai/grok-4.1'), 'x-ai/grok-4.1');
});

test('does not touch provider prefix', () => {
  assert.equal(stripFastSuffix('fast-llm/model'), 'fast-llm/model');
});

test('does not strip substrings (token boundary only)', () => {
  assert.equal(stripFastSuffix('anthropic/claude-fastlane'), 'anthropic/claude-fastlane');
});

test('returns input unchanged when no slash', () => {
  assert.equal(stripFastSuffix('noslash'), 'noslash');
});

test('returns input unchanged when slug is empty', () => {
  assert.equal(stripFastSuffix('provider/'), 'provider/');
});

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

test('hasLatestToken: claude-haiku-latest → true', () => {
  assert.equal(hasLatestToken('anthropic/claude-haiku-latest'), true);
});

test('hasLatestToken: latest-mini → true (token at start)', () => {
  assert.equal(hasLatestToken('openai/latest-mini'), true);
});

test('hasLatestToken: LATEST is case-insensitive', () => {
  assert.equal(hasLatestToken('openai/GPT-LATEST'), true);
});

test('hasLatestToken: claude-sonnet-4.6 → false', () => {
  assert.equal(hasLatestToken('anthropic/claude-sonnet-4.6'), false);
});

test('hasLatestToken: substring "latestmodel" → false (token boundary)', () => {
  assert.equal(hasLatestToken('foo/latestmodel'), false);
});

test('hasLatestToken: no slash, slug only', () => {
  assert.equal(hasLatestToken('something-latest'), true);
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
