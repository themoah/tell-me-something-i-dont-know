import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, escapeHtml, calcOriginality, metaDescription, parseReleasedToTimestamp, topTopicClaim, topicDisplayName, topicEmoji, renderTopicBars, MIN_TOPIC_BAR_COUNT } from './render_site.ts';

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
