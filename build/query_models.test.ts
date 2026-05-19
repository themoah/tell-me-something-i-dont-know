import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceFilter,
  MAX_OUTPUT_PRICE_PER_TOKEN,
  retryTokenBudgets,
  shouldRetryRunResult,
} from './query_models.ts';

const cap = MAX_OUTPUT_PRICE_PER_TOKEN;

test('keeps model below the ceiling', () => {
  const models = [{ id: 'a', name: 'A' }];
  const prices = new Map([['a', cap / 2]]);
  const { kept, skipped } = priceFilter(models, prices, cap);
  assert.deepEqual(kept.map((m) => m.id), ['a']);
  assert.equal(skipped.length, 0);
});

test('drops model above the ceiling', () => {
  const models = [{ id: 'a', name: 'A' }];
  const prices = new Map([['a', cap * 2]]);
  const { kept, skipped } = priceFilter(models, prices, cap);
  assert.equal(kept.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].model.id, 'a');
  assert.equal(skipped[0].pricePerToken, cap * 2);
});

test('keeps model exactly at the ceiling', () => {
  const models = [{ id: 'a', name: 'A' }];
  const prices = new Map([['a', cap]]);
  const { kept, skipped } = priceFilter(models, prices, cap);
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 0);
});

test('keeps model missing from price map (fail-open)', () => {
  const models = [{ id: 'unknown', name: 'U' }];
  const prices = new Map<string, number>();
  const { kept, skipped } = priceFilter(models, prices, cap);
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 0);
});

test('empty input returns empty result', () => {
  const { kept, skipped } = priceFilter([], new Map(), cap);
  assert.equal(kept.length, 0);
  assert.equal(skipped.length, 0);
});

test('MAX_OUTPUT_PRICE_PER_TOKEN equals $50 per 1M tokens', () => {
  assert.equal(MAX_OUTPUT_PRICE_PER_TOKEN, 50 / 1_000_000);
});

test('does not retry complete successful content', () => {
  assert.equal(
    shouldRetryRunResult({ success: true, content: 'Complete answer', finish_reason: 'stop' }),
    false,
  );
});

test('retries successful empty content', () => {
  assert.equal(shouldRetryRunResult({ success: true, content: '', finish_reason: 'stop' }), true);
});

test('retries successful whitespace-only content', () => {
  assert.equal(shouldRetryRunResult({ success: true, content: '   \n\t', finish_reason: 'stop' }), true);
});

test('retries successful content truncated by token limit', () => {
  assert.equal(
    shouldRetryRunResult({
      success: true,
      content: 'Here is a mind-bending fact about the human body and the nature of reality:\n\n**',
      finish_reason: 'length',
    }),
    true,
  );
});

test('does not retry unsuccessful results', () => {
  assert.equal(
    shouldRetryRunResult({ success: false, content: null }),
    false,
  );
});

test('retryTokenBudgets uses 4x larger token caps', () => {
  assert.deepEqual(retryTokenBudgets(500), [10000, 20000, 40000]);
});

test('retryTokenBudgets skips budgets that do not increase the current max tokens', () => {
  assert.deepEqual(retryTokenBudgets(10000), [20000, 40000]);
});
