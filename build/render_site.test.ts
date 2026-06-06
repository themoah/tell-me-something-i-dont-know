import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, escapeHtml, calcOriginality, metaDescription } from './render_site.ts';

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

test('metaDescription is plain text, capped, names the model', () => {
    const model = {
        id: 'x/y', name: 'Test Model', provider: 'X', license: 'commercial',
        runs: [{ success: true, content: '**Bold** fact with `code` and [link](u). ' + 'x'.repeat(300) }],
    } as any;
    const d = metaDescription(model);
    assert.ok(d.startsWith('Test Model answers'));
    assert.ok(!/[#*`\[\]]/.test(d), 'no markdown chars');
    assert.ok(d.length <= 300);
});
