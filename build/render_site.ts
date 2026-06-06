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
import { fileURLToPath } from 'url';
import { marked } from 'marked';

marked.use({ async: false });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, '..', 'site');
const DATA_FILE = path.join(SITE_DIR, 'data.json');
const TEMPLATE_FILE = path.join(SITE_DIR, 'index.template.html');
const INDEX_FILE = path.join(SITE_DIR, 'index.html');
const SITEMAP_FILE = path.join(SITE_DIR, 'sitemap.xml');
const MODELS_DIR = path.join(SITE_DIR, 'm');

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
    'space': '\u{1F30C}', 'trees': '\u{1F333}', 'sloths': '\u{1F9A5}', 'dna': '\u{1F9EC}',
    'oxford university': '\u{1F393}',
    'anglo-zanzibar war': '⚔️',
};

export function escapeHtml(str: unknown): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Stable, URL-safe slug from an OpenRouter model id. */
export function slugify(id: string): string {
    return id.replace(/\//g, '-');
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

export function calcOriginality(model: Model, topTopics: string[]): number {
    let runsWithTopTopic = 0;
    for (const run of model.runs) {
        if (!run.success || !run.topics) continue;
        if (run.topics.some(t => topTopics.includes(t))) runsWithTopTopic++;
    }
    return 3 - runsWithTopTopic;
}

function originalityBadge(score: number): string {
    const filled = '★'.repeat(score);
    const empty = '☆'.repeat(3 - score);
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

function renderTopicBars(stats: Data['stats']): string {
    const topics = stats.topic_frequency;
    const maxCount = Math.max(...Object.values(topics), 1);
    let html = '';
    for (const [topic, count] of Object.entries(topics)) {
        const pct = (count / maxCount * 100).toFixed(1);
        const emoji = TOPIC_EMOJIS[topic] || '\u{1F4CC}';
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

function renderJellyfishCallout(stats: Data['stats']): string {
    const jCount = stats.topic_frequency['jellyfish'];
    if (!jCount) return '';
    const total = stats.total_responses;
    const pct = ((jCount / total) * 100).toFixed(0);
    return `<span class="emoji">\u{1FAB4}</span>
            <span id="callout-text">${jCount} out of ${total} responses mentioned jellyfish (${pct}%). The immortal jellyfish is apparently the default "interesting fact" in LLM training data.</span>`;
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
    const tabsHTML = runs.map((_, i) =>
        `<button class="response-tab ${i === 0 ? 'active' : ''}" data-run="${i}">Run ${i + 1}</button>`
    ).join('');

    let responsesHTML = '';
    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const hidden = i > 0 ? ' hidden' : '';
        if (!run.success) {
            responsesHTML += `<div class="response-text${hidden}" data-run="${i}"><span class="error-text">Error: ${escapeHtml(run.error || 'Unknown error')}</span></div>`;
            continue;
        }
        const topicTags = (run.topics || []).map(t => {
            const emoji = TOPIC_EMOJIS[t] || '';
            return `<span class="topic-tag" data-topic="${escapeHtml(t)}">${emoji} ${escapeHtml(t)}</span>`;
        }).join(' ');
        const reasoningBlock = run.reasoning ? `
                <details class="reasoning-block${hidden}" data-run="${i}">
                    <summary>show reasoning · ${run.tokens_reasoning ?? '?'} tokens</summary>
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

    const totalTokens = runs.reduce((sum, r) => sum + (r.tokens_completion || 0), 0);
    const allTopics = [...new Set(runs.flatMap(r => r.topics || []))].join(',');
    return { tabsHTML, responsesHTML, totalTokens, allTopics };
}

function renderModelCards(models: Model[], topTopics: string[]): string {
    let html = '';
    for (let idx = 0; idx < models.length; idx++) {
        const model = models[idx];
        const licenseLabel = model.license.replace('-', ' ');
        const originality = calcOriginality(model, topTopics);
        const released = parseReleasedToTimestamp(model.released);
        const releasedHTML = model.released ? `<div class="model-released">${escapeHtml(model.released)}</div>` : '';
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
        description: `I've asked ${data.meta.total_models} LLMs '${PROMPT}' Most of them said jellyfish.`,
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
    return `<script type="application/ld+json">${JSON.stringify(webPage)}</script>\n<script type="application/ld+json">${JSON.stringify(itemList)}</script>`;
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
    return `<script type="application/ld+json">${JSON.stringify(qaPage)}</script>`;
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
    model: Model, sharedHead: string, prev: Model | null, next: Model | null, topTopics: string[],
): string {
    const slug = slugify(model.id);
    const url = `${SITE_URL}/m/${slug}/`;
    const title = `${escapeHtml(model.name)} — Tell me something I don't know.`;
    const desc = escapeHtml(metaDescription(model));
    const licenseLabel = model.license.replace('-', ' ');
    const originality = calcOriginality(model, topTopics);
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
            Made with <3 by <a href="https://x.com/themoah" target="_blank" rel="noopener">Aviv Dozorets</a> with a help from Claude Code, 2026.
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

    const modelCount = String(data.meta.total_models);
    const dateStr = new Date(data.meta.generated_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    const topTopics = Object.keys(data.stats.topic_frequency).slice(0, 3);
    const candidates = heroCandidates(data);

    // ---- index.html ----
    let html = template;
    html = html.replace(/(<strong id="model-count">)[^<]*(<\/strong>)/, `$1${modelCount}$2`);
    html = html.replace(/(<strong id="meta-temp">)[^<]*(<\/strong>)/, `$1${data.meta.temperature}$2`);
    html = html.replace(/(<strong id="meta-date">)[^<]*(<\/strong>)/, `$1${dateStr}$2`);
    html = html.replace(/I've asked \d+\+? LLMs/g, `I've asked ${modelCount}+ LLMs`);
    html = html.replace(/(twitter:description" content="I've asked )\d+\+?/, `$1${modelCount}+`);

    // Replacer functions: slot content is model-derived HTML/JSON that may contain
    // `$` (prices, code), which a string 2nd arg would expand (`$&`, `$$`, …).
    html = html.replace('<!-- LD_JSON_SLOT -->', () => buildIndexLdJson(data));
    html = html.replace('<!-- SLOT:hero -->', () => renderHero(candidates));
    html = html.replace('<!-- SLOT:topicbars -->', () => renderTopicBars(data.stats));

    const callout = renderJellyfishCallout(data.stats);
    if (callout) {
        html = html.replace(
            '<div id="jellyfish-callout" class="jellyfish-callout" style="display:none">',
            '<div id="jellyfish-callout" class="jellyfish-callout">',
        );
        html = html.replace('<!-- SLOT:callout -->', () => callout);
    }

    html = html.replace('<!-- SLOT:cards -->', () => renderModelCards(data.models, topTopics));
    html = html.replace(
        '<!-- SLOT:hero_data -->',
        () => `<script>window.__HERO=${JSON.stringify(candidates)};</script>`,
    );

    await fs.writeFile(INDEX_FILE, html, 'utf-8');
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
        await fs.writeFile(path.join(dir, 'index.html'), renderModelPage(model, sharedHead, prev, next, topTopics), 'utf-8');
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
