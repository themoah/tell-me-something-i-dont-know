#!/usr/bin/env tsx
/**
 * Static site build — renders everything from site/data.json into committed HTML.
 *
 * Pipeline:
 *   site/index.template.html  +  site/data.json
 *     -> site/index.html                      (fully static, no client fetch)
 *     -> site/m/<slug>/index.html  (one per model, QAPage structured data)
 *     -> site/sitemap.xml          (index + every model page)
 *
 * The browser never fetches data.json and never parses markdown — markdown is
 * rendered here with `marked`, and site/app.js only wires behaviour onto the
 * pre-rendered DOM.
 *
 * Usage:  npm run build-site
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { primaryTopic } from './query_models.ts';

marked.use({ async: false });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, '..', 'site');
const DATA_FILE = path.join(SITE_DIR, 'data.json');
const TEMPLATE_FILE = path.join(SITE_DIR, 'index.template.html');
const INDEX_FILE = path.join(SITE_DIR, 'index.html');
const SITEMAP_FILE = path.join(SITE_DIR, 'sitemap.xml');
const MODELS_DIR = path.join(SITE_DIR, 'm');
const APP_JS_FILE = path.join(SITE_DIR, 'app.js');

/** Stamp /app.js refs with a content hash so a new build busts the 24h cache. */
function bustAppJs(html: string, version: string): string {
    return html.replaceAll('src="/app.js"', `src="/app.js?v=${version}"`);
}

const SITE_URL = 'https://tellmesomethingidontknow.fyi';
const PROMPT = 'Tell me something I don\'t know.';

interface Run {
    success: boolean;
    content?: string;
    error?: string;
    tokens_prompt?: number;
    tokens_completion?: number;
    tokens_reasoning?: number;
    reasoning?: string;
    finish_reason?: string;
    topics?: string[];
}

interface Model {
    id: string;
    name: string;
    provider: string;
    license: string;
    released?: string;
    runs: Run[];
}

interface Data {
    meta: {
        prompt: string;
        temperature: number;
        max_tokens: number;
        runs_per_model: number;
        generated_at: string;
        total_models: number;
    };
    stats: {
        total_models: number;
        total_responses: number;
        total_tokens: number;
        total_reasoning_tokens: number;
        topic_frequency: Record<string, number>;
    };
    models: Model[];
}

const TOPIC_EMOJIS: Record<string, string> = {
    'jellyfish': '\u{1FAB4}', 'octopus': '\u{1F419}', 'honey': '\u{1F36F}', 'eiffel tower': '\u{1F5FC}',
    'bananas': '\u{1F34C}', 'cleopatra': '\u{1F451}', 'mantis shrimp': '\u{1F990}', 'tardigrade': '\u{1F43B}',
    'blue whale': '\u{1F40B}', 'venus': '\u{1FA90}', 'shakespeare': '\u{1F3AD}', 'platypus': '\u{1F986}',
    'space': '\u{1F30C}', 'wood wide web': '\u{1F333}', 'sloths': '\u{1F9A5}', 'dna': '\u{1F9EC}',
    'oxford university': '\u{1F393}',
    'anglo-zanzibar war': '⚔️',
    'sharks': '\u{1F988}',
    'wombats': '\u{1F43E}',
};

/** Minimum mentions for a topic to appear in the hive-mind bar chart. */
export const MIN_TOPIC_BAR_COUNT = 10;

const TOPIC_DISPLAY_NAMES: Record<string, string> = {
    octopus: 'Octopuses',
    jellyfish: 'Jellyfish',
    honey: 'Honey that never spoils',
    venus: 'Venus',
    cleopatra: 'Cleopatra',
    'anglo-zanzibar war': 'The Anglo-Zanzibar War',
    'oxford university': 'Oxford University',
    bananas: 'Bananas-as-berries',
    sharks: 'Sharks',
    wombats: 'Wombats',
    'wood wide web': 'The wood wide web',
    'eiffel tower': 'The Eiffel Tower',
    sloths: 'Sloths',
    space: 'Space',
    dna: 'DNA',
    tardigrade: 'Tardigrades',
    'mantis shrimp': 'Mantis shrimp',
};

export function topTopic(stats: Data['stats']): string | null {
    const entries = Object.entries(stats.topic_frequency);
    if (!entries.length) return null;
    return entries[0][0];
}

export function topicDisplayName(topic: string): string {
    return TOPIC_DISPLAY_NAMES[topic] || topic.charAt(0).toUpperCase() + topic.slice(1);
}

export function topicEmoji(topic: string): string {
    return TOPIC_EMOJIS[topic] || '\u{1F4CC}';
}

export function topTopicClaim(stats: Data['stats']): string {
    const topic = topTopic(stats);
    if (!topic) return 'The same fun facts keep coming up.';
    return `${topicDisplayName(topic)} came up more than anything else.`;
}

export function escapeHtml(str: unknown): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Stable, URL-safe slug from an OpenRouter model id.
 * Current ids are lowercase [a-z0-9./-]; this also neutralises any stray
 * unsafe char (e.g. ':') without changing existing slugs. */
export function slugify(id: string): string {
    return id
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Safely embed a JSON value inside a <script> tag — prevents `</script>`
 * breakout and U+2028/2029 issues from model-supplied content. */
export function serializeForScriptTag(value: unknown): string {
    return JSON.stringify(value)
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '<\\!--')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** A run we can show: the call succeeded and returned answer text. */
function isPublishableRun(run: { success: boolean; content?: string | null }): boolean {
    return run.success && !!run.content?.trim();
}

/** Models with at least one real answer. Failed and empty runs are removed. */
export function modelsWithAnswers(models: Model[]): Model[] {
    return dedupeBySlug(models)
        .map((m) => ({ ...m, runs: m.runs.filter((r) => isPublishableRun(r)) }))
        .filter((m) => m.runs.length > 0);
}

/** Keep first occurrence per slug — data.json can contain duplicate model ids. */
export function dedupeBySlug(models: Model[]): Model[] {
    const seen = new Set<string>();
    const out: Model[] = [];
    for (const m of models) {
        const s = slugify(m.id);
        if (seen.has(s)) { console.warn(`Skipping duplicate model id: ${m.id}`); continue; }
        seen.add(s);
        out.push(m);
    }
    return out;
}

/** Plain-text, length-capped meta description from a model's first response. */
export function metaDescription(model: Model): string {
    const run = model.runs.find(r => r.success && r.content);
    const text = (run?.content || '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> text
        .replace(/[#*`>_~\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const snippet = text.length > 155 ? text.slice(0, 152).trimEnd() + '…' : text;
    return `${model.name} answers "${PROMPT}" — ${snippet}`.slice(0, 300);
}

const CLAIM_STOP = new Set(
    'that this with from your have been they them their what when where which about there these those into just only also more than then some very really something people might know here fact the and for are was you not but its can'.split(' '),
);

/** First sentence of the answer's opening claim, markdown stripped. */
function claimText(text: string): string {
    const bold = text.match(/\*\*((?:(?!\*\*).){12,400})\*\*/s);
    let raw = bold ? bold[1] : '';
    if (!raw) {
        const skip = /^(here'?s|here is|okay|sure|alright|certainly|of course|great|let me)\b/i;
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const usable = (s: string, min: number) => {
            const plain = s.replace(/[*_#>`]/g, '').trim();
            return plain.length >= min && !skip.test(plain);
        };
        const line = lines.find(s => usable(s, 40)) ?? lines.find(s => usable(s, 1)) ?? '';
        raw = line;
    }
    raw = raw.replace(/[*_#>`\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const end = raw.search(/[.!?]/);
    if (end === -1 || end > 220) return raw.slice(0, 220).trim();
    return raw.slice(0, end + 1).trim();
}

function claimsOverlap(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const ca = claimText(a);
    const cb = claimText(b);
    const tokens = (s: string) => new Set(
        (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(w => !CLAIM_STOP.has(w)),
    );
    const A = tokens(ca);
    const B = tokens(cb);
    if (A.size >= 3 && B.size >= 3) {
        let inter = 0;
        for (const w of A) if (B.has(w)) inter++;
        if (inter / (A.size + B.size - inter) >= 0.5) return true;
    }
    const na = norm(ca);
    const nb = norm(cb);
    return na.length >= 12 && na === nb;
}

function sameFact(a: string, b: string): boolean {
    const ta = primaryTopic(a);
    const tb = primaryTopic(b);
    if (ta && tb) return ta === tb;
    return claimsOverlap(a, b);
}

export function calcOriginality(model: Model, popularTopics: string[]): number {
    const runs = model.runs.filter(r => r.success && !!r.content?.trim());
    if (runs.length === 0) return 1;
    const parent = runs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < runs.length; i++) {
        for (let j = i + 1; j < runs.length; j++) {
            if (sameFact(runs[i].content!, runs[j].content!)) parent[find(i)] = find(j);
        }
    }
    const clusters = new Map<number, Run[]>();
    runs.forEach((run, i) => {
        const root = find(i);
        const group = clusters.get(root) ?? [];
        group.push(run);
        clusters.set(root, group);
    });
    const popular = new Set(popularTopics);
    let offlist = 0;
    for (const group of clusters.values()) {
        const onList = group.some(run => {
            const topic = primaryTopic(run.content ?? '');
            return topic !== null && popular.has(topic);
        });
        if (!onList) offlist++;
    }
    const distinct = clusters.size;
    if (distinct <= 1) return 1;
    if (distinct === 2) return 2;
    if (offlist <= 0) return 3;
    if (offlist === 1) return 4;
    return 5;
}

export function originalityBadge(score: number): string {
    const filled = '★'.repeat(score);
    const empty = '☆'.repeat(5 - score);
    return `<span class="originality-badge" data-score="${score}">${filled}<span class="star-empty">${empty}</span> original</span>`;
}

const MONTHS: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Parse "October 2025" -> timestamp, without engine-dependent Date.parse. */
export function parseReleasedToTimestamp(released?: string): number {
    if (!released) return Number.MAX_SAFE_INTEGER;
    const [monthStr, yearStr] = released.trim().toLowerCase().split(/\s+/);
    const month = MONTHS[monthStr];
    const year = parseInt(yearStr, 10);
    if (month === undefined || Number.isNaN(year)) return Number.MAX_SAFE_INTEGER;
    return new Date(year, month, 1).getTime();
}

/** Topics shown in the Hive Mind section (bars and heatmap), most frequent first. */
export function hiveMindTopics(stats: Data['stats'], minCount = MIN_TOPIC_BAR_COUNT): string[] {
    return Object.entries(stats.topic_frequency).filter(([, count]) => count >= minCount).map(([t]) => t);
}

export function renderTopicBars(stats: Data['stats'], minCount = MIN_TOPIC_BAR_COUNT): string {
    const topics = hiveMindTopics(stats, minCount).map(t => [t, stats.topic_frequency[t]] as const);
    const maxCount = Math.max(...topics.map(([, c]) => c), 1);
    let html = '';
    for (const [topic, count] of topics) {
        const pct = (count / maxCount * 100).toFixed(1);
        const emoji = topicEmoji(topic);
        html += `
            <div class="topic-bar-row" data-topic="${escapeHtml(topic)}">
                <span class="topic-bar-label">${emoji} ${escapeHtml(topic)}</span>
                <div class="topic-bar-track">
                    <div class="topic-bar-fill" style="width: ${pct}%" data-width="${pct}%"></div>
                </div>
                <span class="topic-bar-count">${count}</span>
            </div>`;
    }
    return html;
}

// ---- Topic popularity over model release time: heatmap (inline SVG, no client JS) ----

export interface TrendMonth { ts: number; label: string; runs: number; counts: number[]; }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const emptyMonth = (ts: number, topics: string[]): TrendMonth => {
    const d = new Date(ts);
    return { ts, label: `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`, runs: 0, counts: topics.map(() => 0) };
};

/**
 * Per release month, oldest first: successful runs and, per topic (same order as `topics`), runs
 * mentioning it. Calendar-contiguous: months with no models come back with runs = 0, so the axis
 * never makes a 9-month gap look like one step.
 */
export function topicTrend(models: Model[], topics: string[]): TrendMonth[] {
    const byTs = new Map<number, TrendMonth>();
    for (const model of models) {
        const ts = parseReleasedToTimestamp(model.released);
        if (ts === Number.MAX_SAFE_INTEGER) continue;
        let month = byTs.get(ts);
        if (!month) {
            month = emptyMonth(ts, topics);
            byTs.set(ts, month);
        }
        for (const run of model.runs) {
            if (!run.success) continue;
            month.runs++;
            topics.forEach((t, i) => { if (run.topics?.includes(t)) month!.counts[i]++; });
        }
    }
    const out: TrendMonth[] = [];
    for (const m of [...byTs.values()].sort((a, b) => a.ts - b.ts)) {
        if (out.length) {
            const prev = new Date(out[out.length - 1].ts);
            for (let d = new Date(prev.getFullYear(), prev.getMonth() + 1, 1); d.getTime() < m.ts; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
                out.push(emptyMonth(d.getTime(), topics));
            }
        }
        out.push(m);
    }
    return out;
}

const HEAT_W = 720;
const HEAT_LABEL_W = 160;
const HEAT_ROW_H = 22;
/** Cell shade saturates here: a few tiny early months hit 100% and would wash out everything else. */
const HEAT_SATURATE_PCT = 50;

/** Rows = topics, columns = calendar release months (months without models stay blank), shade = % of that month's responses. */
export function renderTopicHeatmap(months: TrendMonth[], topics: string[]): string {
    if (!months.length || !topics.length) return '';
    const R = 8, T = 6, B = 40;
    const cellW = (HEAT_W - HEAT_LABEL_W - R) / months.length;
    const h = T + topics.length * HEAT_ROW_H + B;
    const pct = (m: TrendMonth, i: number) => (m.runs ? (m.counts[i] / m.runs) * 100 : 0);
    const maxP = Math.min(HEAT_SATURATE_PCT, Math.max(...months.flatMap(m => topics.map((_, i) => pct(m, i))), 1));

    let out = `<svg viewBox="0 0 ${HEAT_W} ${h}" role="img" aria-label="Heatmap of topic popularity by model release month">`;
    topics.forEach((t, i) => {
        const y = T + i * HEAT_ROW_H;
        out += `<g class="heat-row" data-topic="${escapeHtml(t)}" role="button" tabindex="0" aria-label="Filter models by ${escapeHtml(t)}"><text class="heat-tick" x="${HEAT_LABEL_W - 8}" y="${y + HEAT_ROW_H / 2 + 4}" text-anchor="end">${topicEmoji(t)} ${escapeHtml(t)}</text>`;
        months.forEach((m, k) => {
            if (!m.runs) return; // no models that month: leave the column blank
            const p = pct(m, i);
            const opacity = (0.05 + 0.95 * Math.min(1, p / maxP)).toFixed(2);
            const month = m.counts[i] > 0 ? ` data-month="${m.ts}"` : ''; // empty cells aren't clickable
            out += `<rect class="heat-cell"${month} x="${(HEAT_LABEL_W + k * cellW + 1).toFixed(1)}" y="${y + 1}" width="${(cellW - 2).toFixed(1)}" height="${HEAT_ROW_H - 2}" rx="3" fill-opacity="${opacity}">`
                + `<title>${escapeHtml(`${m.label} · ${t}: ${p.toFixed(0)}% (${m.counts[i]} of ${m.runs} responses)`)}</title></rect>`;
        });
        out += '</g>';
    });
    months.forEach((m, k) => {
        const d = new Date(m.ts), x = HEAT_LABEL_W + k * cellW + cellW / 2, y = T + topics.length * HEAT_ROW_H;
        if (k % 3 === 0) { // quarterly month labels, else they collide
            out += `<text class="heat-tick" x="${x.toFixed(1)}" y="${y + 14}" text-anchor="middle">${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}</text>`;
        }
        if (m.runs) out += `<text class="heat-tick heat-n" x="${x.toFixed(1)}" y="${y + 30}" text-anchor="middle">${m.runs}</text>`;
    });
    return out + '</svg>';
}

export function renderTopTopicCallout(stats: Data['stats']): string {
    const topic = topTopic(stats);
    if (!topic) return '';
    const count = stats.topic_frequency[topic];
    if (!count) return '';
    const total = stats.total_responses;
    const pct = ((count / total) * 100).toFixed(0);
    const emoji = topicEmoji(topic);
    return `<span class="emoji">${emoji}</span>
            <span id="callout-text">${count} out of ${total} responses mentioned ${escapeHtml(topic)} (${pct}%). Apparently the default &quot;interesting fact&quot; in LLM training data.</span>`;
}

interface HeroCandidate { snippet: string; model: string; run: number; }

function heroCandidates(data: Data): HeroCandidate[] {
    const out: HeroCandidate[] = [];
    for (const model of data.models) {
        for (let i = 0; i < model.runs.length; i++) {
            const run = model.runs[i];
            if (!run.success || !run.content) continue;
            const boldMatch = run.content.match(/\*\*([^*]+)\*\*/);
            const snippet = boldMatch
                ? boldMatch[1]
                : run.content.split(/[.!?]/)[0].replace(/^#+\s*/, '').trim();
            if (snippet.length > 10) out.push({ snippet, model: model.name, run: i });
        }
    }
    return out;
}

function renderHero(candidates: HeroCandidate[]): string {
    const first = candidates[0];
    if (!first) return '';
    return `<blockquote id="hero-text">${escapeHtml(first.snippet)}</blockquote>
        <span class="hero-attr">
            <span id="hero-model">— ${escapeHtml(first.model)}, Run ${first.run + 1}</span>
            <a class="hero-refresh" id="hero-refresh">another one</a>
        </span>`;
}

/** Tabs + response bodies for a model's runs (shared by index cards and model pages). */
function renderRunBlocks(runs: Run[]) {
    const visible = runs.filter((r) => isPublishableRun(r));
    const tabsHTML = visible.map((_, i) =>
        `<button class="response-tab ${i === 0 ? 'active' : ''}" data-run="${i}">Run ${i + 1}</button>`
    ).join('');

    let responsesHTML = '';
    for (let i = 0; i < visible.length; i++) {
        const run = visible[i];
        const hidden = i > 0 ? ' hidden' : '';
        const topicTags = (run.topics || []).map(t => {
            const emoji = TOPIC_EMOJIS[t] || '';
            return `<span class="topic-tag" data-topic="${escapeHtml(t)}">${emoji} ${escapeHtml(t)}</span>`;
        }).join(' ');
        const reasoningBlock = run.reasoning ? `
                <details class="reasoning-block${hidden}" data-run="${i}">
                    <summary>show reasoning${run.tokens_reasoning != null ? ` · ${run.tokens_reasoning} tokens` : ''}</summary>
                    <div class="reasoning-content">${escapeHtml(run.reasoning)}</div>
                </details>` : '';
        responsesHTML += `
                <div class="response-text${hidden}" data-run="${i}">
                    ${marked.parse(run.content || '') as string}
                </div>
                <div class="response-meta${hidden}" data-run="${i}">
                    <span>${run.tokens_completion} tokens</span>
                    ${topicTags}
                </div>
                ${reasoningBlock}`;
    }

    const totalTokens = visible.reduce((sum, r) => sum + (r.tokens_completion || 0), 0);
    const allTopics = [...new Set(visible.flatMap(r => r.topics || []))].join(',');
    return { tabsHTML, responsesHTML, totalTokens, allTopics };
}

function renderModelCards(models: Model[], popularTopics: string[]): string {
    let html = '';
    for (let idx = 0; idx < models.length; idx++) {
        const model = models[idx];
        const licenseLabel = escapeHtml(model.license.replace('-', ' '));
        const originality = calcOriginality(model, popularTopics);
        const released = parseReleasedToTimestamp(model.released);
        const releasedHTML = model.released ? `<div class="model-released">${escapeHtml(model.released)}</div>` : '';
        if (!model.runs.some((r) => isPublishableRun(r))) continue;
        const { tabsHTML, responsesHTML, totalTokens, allTopics } = renderRunBlocks(model.runs);
        const slug = slugify(model.id);

        html += `
            <div class="model-card" data-license="${escapeHtml(model.license)}" data-topics="${escapeHtml(allTopics)}" data-sort-tokens="${totalTokens}" data-originality="${originality}" data-index="${idx}" data-sort-released="${released}">
                <div class="card-header">
                    <div>
                        <div class="model-name">${escapeHtml(model.name)}</div>
                        <div class="model-provider">${escapeHtml(model.provider)}</div>
                        ${releasedHTML}
                    </div>
                    <div style="text-align: right;">
                        <span class="license-tag ${model.license}">${licenseLabel}</span>
                        ${originalityBadge(originality)}
                    </div>
                </div>
                <div class="response-tabs">${tabsHTML}</div>
                ${responsesHTML}
                <a class="model-permalink" href="/m/${slug}/">Permalink →</a>
            </div>`;
    }
    return html;
}

function buildIndexLdJson(data: Data): string {
    const webPage = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Tell Me Something I Don\'t Know — LLM Edition',
        description: `I've asked ${data.meta.total_models} LLMs '${PROMPT}' ${topTopicClaim(data.stats)}`,
        url: SITE_URL,
        author: { '@type': 'Person', name: 'Aviv Dozorets', url: 'https://x.com/themoah' },
        dateModified: data.meta.generated_at,
    };
    const unique = dedupeBySlug(data.models);
    const itemList = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'LLM answers to "Tell me something I don\'t know."',
        numberOfItems: unique.length,
        itemListElement: unique.map((m, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: m.name,
            url: `${SITE_URL}/m/${slugify(m.id)}/`,
        })),
    };
    return `<script type="application/ld+json">${serializeForScriptTag(webPage)}</script>\n<script type="application/ld+json">${serializeForScriptTag(itemList)}</script>`;
}

function buildModelLdJson(model: Model): string {
    const answers = model.runs.filter(r => r.success && r.content);
    const toAnswer = (run: Run) => ({
        '@type': 'Answer',
        text: run.content,
        author: { '@type': 'Organization', name: model.provider },
    });
    const qaPage = {
        '@context': 'https://schema.org',
        '@type': 'QAPage',
        mainEntity: {
            '@type': 'Question',
            name: PROMPT,
            text: `${PROMPT} (asked to ${model.name})`,
            answerCount: answers.length,
            ...(answers[0] ? { acceptedAnswer: toAnswer(answers[0]) } : {}),
            ...(answers.length > 1 ? { suggestedAnswer: answers.slice(1).map(toAnswer) } : {}),
        },
    };
    return `<script type="application/ld+json">${serializeForScriptTag(qaPage)}</script>`;
}

function buildSitemap(data: Data): string {
    const date = data.meta.generated_at.split('T')[0];
    const urls = [
        `${SITE_URL}/`,
        ...dedupeBySlug(data.models).map(m => `${SITE_URL}/m/${slugify(m.id)}/`),
    ];
    const body = urls.map(loc => `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

/** Per-model page, reusing the shared <head> (CSS/fonts) from the index template. */
function renderModelPage(
    model: Model, sharedHead: string, prev: Model | null, next: Model | null, popularTopics: string[],
): string {
    const slug = slugify(model.id);
    const url = `${SITE_URL}/m/${slug}/`;
    const title = `${escapeHtml(model.name)} — Tell me something I don't know.`;
    const desc = escapeHtml(metaDescription(model));
    const licenseLabel = escapeHtml(model.license.replace('-', ' '));
    const originality = calcOriginality(model, popularTopics);
    const releasedHTML = model.released ? `<div class="model-released">${escapeHtml(model.released)}</div>` : '';
    const { tabsHTML, responsesHTML } = renderRunBlocks(model.runs);

    // Per-page <head>: swap title/description/canonical/og/twitter + QAPage JSON-LD.
    // Replacer functions are used so dynamic values containing `$` are inserted
    // literally (a string 2nd arg would expand `$1`, `$&`, `$$`, etc).
    let head = sharedHead
        .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`)
        .replace(/(<meta name="description" content=")[^"]*(">)/, (_, p1, p2) => p1 + desc + p2)
        .replace(/(<link rel="canonical" href=")[^"]*(">)/, (_, p1, p2) => p1 + url + p2)
        .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_, p1, p2) => p1 + url + p2)
        .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_, p1, p2) => p1 + title + p2)
        .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_, p1, p2) => p1 + desc + p2)
        .replace(/(<meta name="twitter:title" content=")[^"]*(">)/, (_, p1, p2) => p1 + title + p2)
        .replace(/(<meta name="twitter:description" content=")[^"]*(">)/, (_, p1, p2) => p1 + desc + p2)
        .replace('<!-- LD_JSON_SLOT -->', () => buildModelLdJson(model));

    const prevLink = prev ? `<a href="/m/${slugify(prev.id)}/">← ${escapeHtml(prev.name)}</a>` : '<span></span>';
    const nextLink = next ? `<a href="/m/${slugify(next.id)}/">${escapeHtml(next.name)} →</a>` : '<span></span>';

    return `${head}
<body>

<div class="container">
    <header>
        <button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme">
            <span class="theme-icon">☀️</span>
        </button>
        <p class="breadcrumb"><a href="/">← Tell me something I don't know.</a></p>
        <h1>${escapeHtml(model.name)}</h1>
        <p class="subtitle">${escapeHtml(model.provider)} · <span class="license-tag ${model.license}">${licenseLabel}</span> ${originalityBadge(originality)}</p>
        <div class="meta-line">
            <span>Prompt: <strong>"${PROMPT}"</strong></span>
            ${model.released ? `<span>Released: <strong>${escapeHtml(model.released)}</strong></span>` : ''}
        </div>
        <div class="share-row">
            <span class="filter-label">Share:</span>
            <a id="share-x" class="share-link" target="_blank" rel="noopener">X</a>
            <a id="share-facebook" class="share-link" target="_blank" rel="noopener">Facebook</a>
            <a id="share-reddit" class="share-link" target="_blank" rel="noopener">Reddit</a>
            <a id="share-linkedin" class="share-link" target="_blank" rel="noopener">LinkedIn</a>
            <a id="share-copy" class="share-link">Copy Link</a>
        </div>
    </header>

    <section class="models-section">
        <div class="model-grid model-grid-single">
            <div class="model-card visible">
                <div class="card-header">
                    <div>
                        <div class="model-name">${escapeHtml(model.name)}</div>
                        <div class="model-provider">${escapeHtml(model.provider)}</div>
                        ${releasedHTML}
                    </div>
                    <div style="text-align: right;">
                        <span class="license-tag ${model.license}">${licenseLabel}</span>
                        ${originalityBadge(originality)}
                    </div>
                </div>
                <div class="response-tabs">${tabsHTML}</div>
                ${responsesHTML}
            </div>
        </div>
        <nav class="model-nav">
            ${prevLink}
            <a href="/">all models</a>
            ${nextLink}
        </nav>
    </section>
</div>

<footer>
    <div class="container">
        <p>
            Built for fun. Responses queried via <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a>.
            Each model was asked 3 times with identical parameters.
        </p>
        <p style="margin-top: 8px;">
            <a href="https://github.com/themoah/tell-me-something-i-dont-know" target="_blank" rel="noopener">Source on GitHub</a>
            Made with &lt;3 by <a href="https://x.com/themoah" target="_blank" rel="noopener">Aviv Dozorets</a> with a help from Claude Code, 2026.
        </p>
    </div>
</footer>

<script>
(function() {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();
</script>
<script defer src="/app.js"></script>

</body>
</html>
`;
}

async function main() {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const data: Data = JSON.parse(raw);
    const template = await fs.readFile(TEMPLATE_FILE, 'utf-8');

    const visibleModels = modelsWithAnswers(data.models);
    data.models = visibleModels;
    data.meta = { ...data.meta, total_models: visibleModels.length };

    const modelCount = String(visibleModels.length);
    const dateStr = new Date(data.meta.generated_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    const popularTopics = Object.keys(data.stats.topic_frequency).slice(0, 10);
    const claim = topTopicClaim(data.stats);
    const metaDesc = `I've asked ${modelCount}+ LLMs the same question. ${claim}`;
    const ogDesc = `I've asked ${modelCount}+ LLMs '${PROMPT}' ${claim}`;
    const candidates = heroCandidates(data);

    const appJs = await fs.readFile(APP_JS_FILE, 'utf-8');
    const appVersion = crypto.createHash('sha256').update(appJs).digest('hex').slice(0, 8);

    // ---- index.html ----
    let html = template;
    html = html.replace(/(<strong id="model-count">)[^<]*(<\/strong>)/, `$1${modelCount}$2`);
    html = html.replace(/(<strong id="meta-temp">)[^<]*(<\/strong>)/, `$1${data.meta.temperature}$2`);
    html = html.replace(/(<strong id="meta-date">)[^<]*(<\/strong>)/, `$1${dateStr}$2`);
    html = html.replace(
        /(<meta name="description" content=")[^"]*(")/,
        (_, a, b) => `${a}${escapeHtml(metaDesc)}${b}`,
    );
    html = html.replace(
        /(<meta property="og:description" content=")[^"]*(")/,
        (_, a, b) => `${a}${escapeHtml(ogDesc)}${b}`,
    );
    html = html.replace(
        /(<meta name="twitter:description" content=")[^"]*(")/,
        (_, a, b) => `${a}${escapeHtml(ogDesc)}${b}`,
    );

    // Replacer functions: slot content is model-derived HTML/JSON that may contain
    // `$` (prices, code), which a string 2nd arg would expand (`$&`, `$$`, …).
    html = html.replace('<!-- LD_JSON_SLOT -->', () => buildIndexLdJson(data));
    html = html.replace('<!-- SLOT:top_topic_claim -->', () => escapeHtml(claim));
    const leader = topTopic(data.stats);
    html = html.replace(
        '<!-- SLOT:hive_mind_emoji -->',
        () => leader ? topicEmoji(leader) : '\u{1F419}',
    );
    html = html.replace('<!-- SLOT:hero -->', () => renderHero(candidates));
    html = html.replace('<!-- SLOT:topicbars -->', () => renderTopicBars(data.stats));
    const heatTopics = hiveMindTopics(data.stats);
    html = html.replace('<!-- SLOT:heatmap -->', () => renderTopicHeatmap(topicTrend(data.models, heatTopics), heatTopics));

    const callout = renderTopTopicCallout(data.stats);
    if (callout) {
        html = html.replace(
            '<div id="jellyfish-callout" class="jellyfish-callout" style="display:none">',
            '<div id="jellyfish-callout" class="jellyfish-callout">',
        );
        html = html.replace('<!-- SLOT:callout -->', () => callout);
    }

    html = html.replace('<!-- SLOT:cards -->', () => renderModelCards(dedupeBySlug(data.models), popularTopics));
    html = html.replace(
        '<!-- SLOT:hero_data -->',
        () => `<script>window.__HERO=${serializeForScriptTag(candidates)};</script>`,
    );

    await fs.writeFile(INDEX_FILE, bustAppJs(html, appVersion), 'utf-8');
    console.log(`Rendered index.html with ${data.models.length} model cards`);

    // ---- per-model pages ----
    const sharedHead = template.slice(0, template.indexOf('</head>') + '</head>'.length);
    const uniqueModels = dedupeBySlug(data.models);
    await fs.rm(MODELS_DIR, { recursive: true, force: true });
    for (let i = 0; i < uniqueModels.length; i++) {
        const model = uniqueModels[i];
        const prev = i > 0 ? uniqueModels[i - 1] : null;
        const next = i < uniqueModels.length - 1 ? uniqueModels[i + 1] : null;
        const dir = path.join(MODELS_DIR, slugify(model.id));
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'index.html'), bustAppJs(renderModelPage(model, sharedHead, prev, next, popularTopics), appVersion), 'utf-8');
    }
    console.log(`Rendered ${uniqueModels.length} model pages into site/m/`);

    // ---- sitemap ----
    await fs.writeFile(SITEMAP_FILE, buildSitemap(data), 'utf-8');
    console.log('Generated sitemap.xml');
    console.log('Done!');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
    main().catch(err => { console.error(err); process.exit(1); });
}
