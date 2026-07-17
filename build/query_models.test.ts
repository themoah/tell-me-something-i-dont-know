import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceFilter,
  MAX_OUTPUT_PRICE_PER_TOKEN,
  queryModel,
  retryTokenBudgets,
  shouldRetryRunResult,
} from './query_models.ts';

// OpenRouter flushes 200 + keep-alive whitespace before the upstream reply, so a
// provider 429 arrives as a body error with no choices. Must not read choices[0].
function stubFetch(bodies: unknown[]) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const body = bodies[Math.min(calls++, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = real; }, calls: () => calls };
}

const rateLimited = { error: { message: 'Provider returned error', code: 429 } };
const ok = {
  choices: [{ message: { content: 'a fact' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 2 },
};

test('provider error in a 200 body reports the error, not a TypeError', async () => {
  const f = stubFetch([rateLimited]);
  try {
    const r = await queryModel('m', 'p', 0.7, 500, 'k');
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /429/);
    assert.doesNotMatch(r.error ?? '', /Cannot read properties/);
  } finally {
    f.restore();
  }
});

test('retries a rate-limited provider and keeps the eventual answer', async () => {
  const f = stubFetch([rateLimited, ok]);
  try {
    const r = await queryModel('m', 'p', 0.7, 500, 'k');
    assert.equal(r.success, true);
    assert.equal(r.content, 'a fact');
    assert.equal(r.retryable, undefined);
    assert.equal(f.calls(), 2);
  } finally {
    f.restore();
  }
});

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

test('MAX_OUTPUT_PRICE_PER_TOKEN equals $30 per 1M tokens', () => {
  assert.equal(MAX_OUTPUT_PRICE_PER_TOKEN, 30 / 1_000_000);
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
