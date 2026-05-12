import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFilter, MAX_OUTPUT_PRICE_PER_TOKEN } from './query_models.ts';

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
