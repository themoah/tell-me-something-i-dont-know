import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, escapeHtml, calcOriginality, metaDescription, parseReleasedToTimestamp, topTopicClaim, topicDisplayName, topicEmoji, renderTopicBars, topicTrend, renderTopicHeatmap, hiveMindTopics, modelsWithAnswers, MIN_TOPIC_BAR_COUNT } from './render_site.ts';

test('slugify replaces all slashes', () => {
    assert.equal(slugify('anthropic/claude-sonnet-4.6'), 'anthropic-claude-sonnet-4.6');
    assert.equal(slugify('a/b/c'), 'a-b-c');
    assert.equal(slugify('no-slash'), 'no-slash');
});

test('escapeHtml escapes all special chars', () => {
    assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('calcOriginality: 3 minus runs touching a top topic', () => {
    const model = {
        id: 'x/y', name: 'Y', provider: 'X', license: 'commercial',
        runs: [
            { success: true, topics: ['jellyfish'] },
            { success: true, topics: ['venus'] },
            { success: true, topics: [] },
        ],
    } as any;
    assert.equal(calcOriginality(model, ['jellyfish', 'octopus', 'honey']), 2);
    assert.equal(calcOriginality(model, ['venus', 'jellyfish', 'honey']), 1);
});

test('metaDescription is plain text, capped, strips link URLs, names the model', () => {
    const model = {
        id: 'x/y', name: 'Test Model', provider: 'X', license: 'commercial',
        runs: [{ success: true, content: '**Bold** fact with `code` and [link](http://u). ' + 'x'.repeat(300) }],
    } as any;
    const d = metaDescription(model);
    assert.ok(d.startsWith('Test Model answers'));
    assert.ok(!/[#*`\[\]]/.test(d), 'no markdown chars');
    assert.ok(!d.includes('http://u'), 'link URL stripped');
    assert.ok(d.includes('link'), 'link text kept');
    assert.ok(d.length <= 300);
});

test('parseReleasedToTimestamp handles month-year and bad input', () => {
    assert.equal(parseReleasedToTimestamp('October 2025'), new Date(2025, 9, 1).getTime());
    assert.equal(parseReleasedToTimestamp('  january   2026 '), new Date(2026, 0, 1).getTime());
    assert.equal(parseReleasedToTimestamp(undefined), Number.MAX_SAFE_INTEGER);
    assert.equal(parseReleasedToTimestamp('garbage'), Number.MAX_SAFE_INTEGER);
    assert.ok(parseReleasedToTimestamp('December 2025') > parseReleasedToTimestamp('January 2025'));
});

test('topTopicClaim uses plural display name for the leader', () => {
    const stats = {
        total_models: 10,
        total_responses: 30,
        total_tokens: 0,
        total_reasoning_tokens: 0,
        topic_frequency: { octopus: 20, jellyfish: 10 },
    };
    assert.equal(topTopicClaim(stats), 'Octopuses came up more than anything else.');
    assert.equal(topicDisplayName('wood wide web'), 'The wood wide web');
});

test('wombats topic uses paw prints, not hippo', () => {
    assert.equal(topicEmoji('wombats'), '🐾');
    assert.notEqual(topicEmoji('wombats'), '🦛');
});

test('renderTopicBars omits topics below the threshold', () => {
    const stats = {
        total_models: 10,
        total_responses: 30,
        total_tokens: 0,
        total_reasoning_tokens: 0,
        topic_frequency: { octopus: 20, jellyfish: 12, sloths: 3 },
    };
    const html = renderTopicBars(stats, MIN_TOPIC_BAR_COUNT);
    assert.ok(html.includes('octopus'));
    assert.ok(html.includes('jellyfish'));
    assert.ok(!html.includes('sloths'));
});

test('modelsWithAnswers omits a model whose runs all failed', () => {
    const models = [
        {
            id: 'a/bad', name: 'Bad', provider: 'P', license: 'commercial',
            runs: [
                { success: false, content: null, error: 'HTTP 429' },
                { success: false, content: null, error: 'HTTP 429' },
            ],
        },
        {
            id: 'b/ok', name: 'Ok', provider: 'P', license: 'commercial',
            runs: [{ success: true, content: 'A fact' }],
        },
    ] as any;
    const visible = modelsWithAnswers(models);
    assert.deepEqual(visible.map((m) => m.id), ['b/ok']);
});

test('modelsWithAnswers keeps only successful runs', () => {
    const models = [{
        id: 'a/mix', name: 'Mix', provider: 'P', license: 'commercial',
        runs: [
            { success: true, content: 'First' },
            { success: false, content: null, error: 'timeout' },
            { success: true, content: '   ' },
            { success: true, content: 'Third' },
        ],
    }] as any;
    const visible = modelsWithAnswers(models);
    assert.equal(visible.length, 1);
    assert.deepEqual(visible[0].runs.map((r) => r.content), ['First', 'Third']);
});

test('topicTrend buckets successful runs by release month, oldest first', () => {
    const run = (topics: string[], success = true) => ({ success, topics });
    const models = [
        { id: 'a/new', released: 'March 2026', runs: [run(['octopus']), run([]), run(['octopus'], false)] },
        { id: 'a/old', released: 'January 2025', runs: [run(['sharks', 'octopus'])] },
        { id: 'a/nodate', runs: [run(['octopus'])] },
    ] as any;
    const months = topicTrend(models, ['octopus', 'sharks']);
    assert.deepEqual([months[0].label, months[0].runs, months[0].counts], ['Jan 2025', 1, [1, 1]]);
    const last = months[months.length - 1];
    assert.deepEqual([last.label, last.runs, last.counts], ['Mar 2026', 2, [1, 0]]); // failed run ignored; undated model skipped
    assert.equal(months.length, 15); // Jan 2025..Mar 2026, every calendar month
    assert.ok(months.slice(1, -1).every(m => m.runs === 0), 'gap months are present and empty');
});

test('renderTopicHeatmap: one cell per topic x month, tooltip carries the numbers', () => {
    const months = [
        { ts: 1, label: 'Jan 2025', runs: 4, counts: [2, 0] },
        { ts: 2, label: 'Feb 2025', runs: 5, counts: [0, 5] },
    ];
    const html = renderTopicHeatmap(months, ['octopus', 'sharks']);
    assert.equal((html.match(/class="heat-cell"/g) || []).length, 4);
    assert.equal((html.match(/data-month="\d+"/g) || []).length, 2); // only non-empty cells are clickable
    assert.ok(html.includes('Jan 2025 · octopus: 50% (2 of 4 responses)'));
    assert.equal((html.match(/<g class="heat-row" data-topic="(octopus|sharks)" role="button"/g) || []).length, 2);
    assert.equal(renderTopicHeatmap([], ['octopus']), '');
    const withGap = [months[0], { ts: 2, label: 'Feb 2025', runs: 0, counts: [0, 0] }, months[1]];
    assert.equal((renderTopicHeatmap(withGap, ['octopus', 'sharks']).match(/class="heat-cell"/g) || []).length, 4); // empty month draws no cells
});

test('hiveMindTopics matches the bar chart threshold', () => {
    const stats = { topic_frequency: { a: 20, b: MIN_TOPIC_BAR_COUNT, c: MIN_TOPIC_BAR_COUNT - 1 } } as any;
    assert.deepEqual(hiveMindTopics(stats), ['a', 'b']);
});
