import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, escapeHtml, calcOriginality, originalityBadge, metaDescription, parseReleasedToTimestamp, topTopicClaim, topicDisplayName, topicEmoji, renderTopicBars, topicTrend, renderTopicHeatmap, hiveMindTopics, modelsWithAnswers, MIN_TOPIC_BAR_COUNT } from './render_site.ts';

const POPULAR = ['octopus', 'sharks', 'jellyfish', 'cleopatra', 'honey', 'oxford university', 'venus', 'wombats', 'anglo-zanzibar war', 'bananas'];

function model(contents: string[]) {
    return {
        id: 'x/y', name: 'Y', provider: 'X', license: 'commercial',
        runs: contents.map(content => ({ success: true, content })),
    } as any;
}

test('slugify replaces all slashes', () => {
    assert.equal(slugify('anthropic/claude-sonnet-4.6'), 'anthropic-claude-sonnet-4.6');
    assert.equal(slugify('a/b/c'), 'a-b-c');
    assert.equal(slugify('no-slash'), 'no-slash');
});

test('escapeHtml escapes all special chars', () => {
    assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('calcOriginality: same topic with different wording scores 1', () => {
    const m = model([
        'Octopuses have three hearts.',
        'An octopus pumps blood with two of its hearts.',
        'The octopus has blue blood.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 1);
});

test('calcOriginality: a reworded untagged fact repeated three times scores 1', () => {
    const m = model([
        'Your brain actively reconstructs the past every time you remember it.',
        'Your brain actively reconstructs the past every time you remember it.',
        'Your brain actively reconstructs your past memories every time you recall them.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 1);
});

test('calcOriginality: three different popular facts score 3', () => {
    const m = model([
        'An octopus has three hearts.',
        'Sharks are older than trees.',
        'The immortal jellyfish can revert to a polyp.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 3);
});

test('calcOriginality: three different facts with one off the list score 4', () => {
    const m = model([
        'An octopus has three hearts.',
        'Sharks are older than trees.',
        'Scotland chose the unicorn as its national animal in the twelfth century.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 4);
});

test('calcOriginality: three different facts with two off the list score 5', () => {
    const m = model([
        'An octopus has three hearts.',
        'The total weight of all the ants on Earth matches the weight of all humans.',
        'Scotland chose the unicorn as its national animal in the twelfth century.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 5);
});

test('calcOriginality: two facts score 2', () => {
    const m = model([
        'An octopus has three hearts.',
        'An octopus has blue blood.',
        'Scotland chose the unicorn as its national animal in the twelfth century.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('calcOriginality: a shared preamble does not merge different topics', () => {
    const m = model([
        "Here's something you might not know. An octopus has three hearts and blue blood.",
        "Here's something you might not know. Sharks are older than trees by a wide margin.",
        "Here's something you might not know. The immortal jellyfish reverts to a polyp.",
    ]);
    assert.equal(calcOriginality(m, POPULAR), 3);
});

test('calcOriginality: a later popular mention does not recast the earliest topic', () => {
    const m = model([
        'Trees share carbon through the wood wide web. Sharks are older than trees.',
        'An octopus has three hearts.',
        'The immortal jellyfish reverts to a polyp.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 4);
});

test('calcOriginality: identical short claims are one fact', () => {
    const m = model([
        'Prime numbers.',
        'Prime numbers.',
        'Scotland chose the unicorn as its national animal in the twelfth century.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('calcOriginality: failed runs are ignored and two answers cannot score 5', () => {
    const failed = {
        id: 'x/y', name: 'Y', provider: 'X', license: 'commercial',
        runs: [
            { success: true, content: 'An octopus has three hearts.' },
            { success: false, content: null },
            { success: true, content: 'An octopus has blue blood.' },
        ],
    } as any;
    assert.equal(calcOriginality(failed, POPULAR), 1);
    const two = model([
        'Scotland chose the unicorn as its national animal in the twelfth century.',
        'The total weight of all the ants on Earth matches the weight of all humans.',
    ]);
    assert.equal(calcOriginality(two, POPULAR), 2);
});

test('calcOriginality: a lead-in on the same line does not hide a repeated fact', () => {
    const m = model([
        "Here's a fact many people might not know: The longest word in the English language is pneumonoultramicroscopicsilicovolcanoconiosis.",
        "Here's something you might not know: the longest word in the English language is pneumonoultramicroscopicsilicovolcanoconiosis.",
        "Here's something you might not know: the shortest war in history was between Britain and Zanzibar on August 27, 1896.",
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('calcOriginality: the opening sentence wins over a later bold word', () => {
    const m = model([
        'You are literally glowing right now. Researchers measured biophotons from human skin.',
        'Your immune system does not know your eyes exist. The proteins are hidden from white blood cells.',
        'Your immune system does not know your eyes exist. Your eyes have **"immune privilege."** Inflammation would blind you.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('calcOriginality: text between short bold words is not the claim', () => {
    const m = model([
        'The little dot above a lowercase **i** or **j** is called a **tittle**.',
        'The **b** in **"debt"** is silent because Latin spelling added it.',
        'The little dot above a lowercase **i** or **j** is called a **tittle**. The word comes from Latin.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('calcOriginality: a lead-in line yields the next sentence', () => {
    const m = model([
        'You may not know that honeybees can recognize human faces. They learn patterns of features.',
        "I don't know what you already know, but here's one you might not:\n\nHoneybees can recognize human faces. They associate facial patterns with rewards.",
        'You may not know this: honey never spoils. Archaeologists have found edible honey in ancient Egyptian tombs.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('originalityBadge renders five stars', () => {
    assert.equal(
        originalityBadge(5),
        '<span class="originality-badge" data-score="5">★★★★★<span class="star-empty"></span> original</span>',
    );
    assert.equal(
        originalityBadge(1),
        '<span class="originality-badge" data-score="1">★<span class="star-empty">☆☆☆☆</span> original</span>',
    );
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

test('calcOriginality: an untagged answer does not bridge two different topics', () => {
    const m = model([
        'Octopus creatures evolved long before trees existed anywhere.',
        'Shark creatures evolved long before trees existed anywhere.',
        'Ancient creatures evolved long before trees existed anywhere.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});

test('calcOriginality: a decimal point does not end the claim', () => {
    const m = model([
        'The average cloud weighs about 1.1 million pounds.',
        'The average cloud weighs about 1.5 grams per cubic meter of water droplets.',
    ]);
    assert.equal(calcOriginality(m, POPULAR), 2);
});
