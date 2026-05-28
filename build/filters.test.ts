import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugHasToken, hasFastToken, hasLatestToken } from './filters.ts';

test('slugHasToken: matches a delimited word in the slug', () => {
  assert.equal(slugHasToken('x-ai/grok-4.1-fast', 'fast'), true);
});

test('slugHasToken: does not match substrings (token boundary only)', () => {
  assert.equal(slugHasToken('anthropic/claude-fastlane', 'fast'), false);
});

test('hasFastToken: -fast suffix → true', () => {
  assert.equal(hasFastToken('x-ai/grok-4.1-fast'), true);
});

test('hasFastToken: -fast- in middle of slug → true', () => {
  assert.equal(hasFastToken('x-ai/grok-4.1-fast-mini'), true);
});

test('hasFastToken: case-insensitive', () => {
  assert.equal(hasFastToken('x-ai/GROK-4.1-FAST'), true);
});

test('hasFastToken: no fast token → false', () => {
  assert.equal(hasFastToken('x-ai/grok-4.1'), false);
});

test('hasFastToken: provider prefix is ignored', () => {
  assert.equal(hasFastToken('fast-llm/model'), false);
});

test('hasFastToken: substring "fastlane" → false (token boundary)', () => {
  assert.equal(hasFastToken('anthropic/claude-fastlane'), false);
});

test('hasFastToken: no slash, slug only → true', () => {
  assert.equal(hasFastToken('something-fast'), true);
});

test('hasFastToken: empty slug → false', () => {
  assert.equal(hasFastToken('provider/'), false);
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
