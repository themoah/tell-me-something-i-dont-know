import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripFastSuffix } from './update_models.ts';

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
