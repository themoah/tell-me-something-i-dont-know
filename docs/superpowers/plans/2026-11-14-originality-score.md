# Originality score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rescore each model's originality from 1 to 5 based on how many distinct facts its runs give and how many of those facts sit outside the top 10 topics.

**Architecture:** `primaryTopic` in `build/query_models.ts` picks the earliest keyword match using the existing keyword table. `calcOriginality` in `build/render_site.ts` clusters publishable runs by that topic, falling back to opening-claim overlap when a run has no topic, then maps cluster counts to stars. The index template draws a 5-star badge; `npm run build-site` regenerates the committed HTML.

**Tech Stack:** TypeScript ESM, `tsx`, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-originality-score-design.md`

## Global Constraints

- ESM only. No `__dirname`; use `path.dirname(fileURLToPath(import.meta.url))` where a path is needed.
- `build/models.yaml` is append-only. This work does not touch it.
- Do not modify `site/data.json`.
- `detectTopics` matches the same keywords it matches today. `primaryTopic` reads that table; it does not add topics.
- Popular topics are `Object.keys(stats.topic_frequency).slice(0, 10)` (already sorted by count, most frequent first).
- Cloudflare Pages serves the committed HTML. A score change is not done until `npm run build-site` rewrites `site/index.html` and `site/m/*/index.html`.
- Scores are integers 1 through 5. `'☆'.repeat(3 - score)` throws on 5; the badge width is 5.

## Review Focus

- A reworded untagged fact repeated three times scores 1. Test: `calcOriginality: a reworded untagged fact repeated three times scores 1` in Task 2.
- The same topic with different wording is one fact. Test: `calcOriginality: same topic with different wording scores 1` in Task 2.
- A shared preamble does not glue different topics together. Test: `calcOriginality: a shared preamble does not merge different topics` in Task 2.
- The earliest topic wins, so a later popular mention stays off-list. Test: `calcOriginality: a later popular mention does not recast the earliest topic` in Task 2.
- A score of 5 renders five filled stars and does not throw. Test: `originalityBadge renders five stars` in Task 2.

---

### Task 1: Earliest topic

**Files:**
- Modify: `build/query_models.ts` (the `detectTopics` keyword table, around lines 260–296)
- Test: `build/query_models.test.ts`

**Interfaces:**
- Consumes: the existing `topicKeywords` table inside `detectTopics`.
- Produces: `export function primaryTopic(text: string): string | null`. Hoist `topicKeywords` to a module-level const and use it from both `detectTopics` and `primaryTopic`. Return the topic whose regex matches at the smallest index. Return `null` when nothing matches. Do not change `detectTopics` results.

- [ ] **Step 1: Write the failing test**

Add to `build/query_models.test.ts`, importing `primaryTopic`:

```ts
test('primaryTopic returns the earliest matching topic', () => {
  assert.equal(
    primaryTopic('Jellyfish drift by. An octopus has three hearts.'),
    'jellyfish',
  );
  assert.equal(
    primaryTopic('An octopus has three hearts. Jellyfish drift by.'),
    'octopus',
  );
  assert.equal(
    primaryTopic('Trees share carbon through the wood wide web. Sharks are older than trees.'),
    'wood wide web',
  );
  assert.equal(primaryTopic('Municipal bonds funded the aqueduct.'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --import tsx build/query_models.test.ts`

Expected: FAIL, `primaryTopic` is not exported.

- [ ] **Step 3: Implement `primaryTopic(text: string): string | null` in `build/query_models.ts`**

Hoist the keyword table. For each keyword, `new RegExp(kw).exec` on the lowercased text and keep the match with the smallest `index`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --import tsx build/query_models.test.ts`

Expected: PASS, including the existing `detectTopics` tests.

- [ ] **Step 5: Commit**

```bash
git add build/query_models.ts build/query_models.test.ts
git commit -m "$(cat <<'EOF'
Pick each answer's earliest topic for originality.

EOF
)"
```

---

### Task 2: Star score

**Files:**
- Modify: `build/render_site.ts` (`calcOriginality` around lines 204–217; import `primaryTopic` from `./query_models.ts`)
- Test: `build/render_site.test.ts` (replace the test named `calcOriginality: 3 minus runs touching a top topic`)

**Interfaces:**
- Consumes: `primaryTopic(text: string): string | null` from Task 1.
- Produces: `export function calcOriginality(model: Model, popularTopics: string[]): number` returning 1..5. `export function originalityBadge(score: number): string` with five star slots. Rename the `topTopics` parameter of `renderModelCards` and `renderModelPage` to `popularTopics`. Leave the call site in `main` on `.slice(0, 3)` until Task 3.

Clustering rules, applied only to runs with `success` and non-empty `content`:

- Two runs with primary topics are the same fact exactly when those topics are equal. Wording is ignored in that case.
- Otherwise they are the same fact when the opening claims overlap.
- Claim text is the first sentence of the first `**...**` span of at least 12 characters, allowing single asterisks inside the span. With no such span, use the first sentence of the first line that is at least 40 characters and does not start with here's, here is, okay, sure, alright, certainly, of course, great, or let me. A sentence runs to the first `.`, `!`, or `?`, capped at 220 characters. Strip markdown.
- Overlap: lowercase tokens matching `[a-z]{3,}`, minus the stop words that, this, with, from, your, have, been, they, them, their, what, when, where, which, about, there, these, those, into, just, only, also, more, than, then, some, very, really, something, people, might, know, here, fact, the, and, for, are, was, you, not, but, its, can. Jaccard `>= 0.5` when both sides have at least 3 tokens. Otherwise the stripped lowercase claims match and are at least 12 characters.
- Cluster membership is transitive.
- A cluster is off-list when no run in it has a primary topic in `popularTopics`.
- 1 distinct fact → 1. 2 → 2. 3 or more with 0 off-list → 3, with 1 → 4, with 2 or more → 5.
- No publishable runs → 1.

`originalityBadge`: filled `★` repeated `score` times, empty `☆` repeated `5 - score` times, `data-score` set to the score. Same markup as today.

- [ ] **Step 1: Replace the old test with these failing tests**

Delete `calcOriginality: 3 minus runs touching a top topic`. Add tests that build a model as `{ id, name, provider, license, runs: contents.map(content => ({ success: true, content })) }`. Popular list for these tests: `['octopus', 'sharks', 'jellyfish', 'cleopatra', 'honey', 'oxford university', 'venus', 'wombats', 'anglo-zanzibar war', 'bananas']`.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --import tsx build/render_site.test.ts`

Expected: FAIL. The old scorer returns values other than the new assertions, and `originalityBadge` is not exported.

- [ ] **Step 3: Implement the scorer and export the badge**

Import `primaryTopic` from `./query_models.ts`. Replace `calcOriginality` with the clustering rules above. Export `originalityBadge` and size it to 5 stars. Update its callers. Do not change the `slice(0, 3)` in `main` yet.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build/render_site.ts build/render_site.test.ts
git commit -m "$(cat <<'EOF'
Score originality from how many distinct facts a model gives.

EOF
)"
```

---

### Task 3: Five-star badge and rebuilt pages

**Files:**
- Modify: `build/render_site.ts` (the `slice(0, 3)` call in `main`, around line 639)
- Modify: `site/index.template.html` (`.originality-badge[data-score]` rules, around lines 260–263)
- Generated: `site/index.html`, `site/m/*/index.html`

**Interfaces:**
- Consumes: `calcOriginality(model, popularTopics)` and `originalityBadge` from Task 2.
- Produces: rendered pages whose `data-originality` and badge `data-score` use the 1–5 scale against the top 10 topics. `site/app.js` already sorts on `data-originality` numerically; leave it.

- [ ] **Step 1: Point the build at the top 10 and recolor the badge**

In `main`, replace `slice(0, 3)` with `slice(0, 10)` and pass that array as `popularTopics`.

In `site/index.template.html`, replace the `data-score` color rules with:

```css
.originality-badge[data-score="5"] { color: var(--open-source); }
.originality-badge[data-score="4"] { color: var(--open-source); }
.originality-badge[data-score="3"] { color: var(--accent); }
.originality-badge[data-score="2"] { color: var(--text-dim); }
.originality-badge[data-score="1"] { color: var(--text-faint); }
```

Delete the `data-score="0"` rule.

- [ ] **Step 2: Rebuild the site**

Run: `npm run build-site`

Expected: the command exits 0.

- [ ] **Step 3: Check known models on the built pages**

Run:

```bash
node --input-type=module -e '
import fs from "fs";
const pages = {
  "site/m/anthropic-claude-haiku-4.5/index.html": "1",
  "site/m/inclusionai-ling-2.6-flash/index.html": "3",
  "site/m/google-gemini-2.5-flash-lite-preview-09-2025/index.html": "5",
};
for (const [file, score] of Object.entries(pages)) {
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes(`data-score="${score}"`)) {
    console.error(file, "missing score", score);
    process.exit(1);
  }
}
const index = fs.readFileSync("site/index.html", "utf8");
if (!index.includes("data-score=\"5\"") || !index.includes(".originality-badge[data-score=\"5\"]")) {
  console.error("index missing a five-star badge");
  process.exit(1);
}
console.log("ok");
'
```

Expected: `ok`. Haiku repeats octopus (1). Ling 2.6 Flash gives octopus, honey, and jellyfish (3). Gemini 2.5 Flash Lite gives three untagged facts (5).

- [ ] **Step 4: Run the tests again**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build/render_site.ts site/index.template.html site/index.html site/m
git commit -m "$(cat <<'EOF'
Show originality on a five-star scale.

EOF
)"
```
