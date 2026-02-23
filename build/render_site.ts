#!/usr/bin/env tsx
/**
 * Pre-render build script — injects static HTML into index.html for SEO.
 *
 * Reads site/data.json and:
 *  - Replaces the loading spinner in #model-grid with pre-rendered <article> cards
 *  - Fills the topic bars section with static content
 *  - Updates dynamic values (model count, temperature, date)
 *  - Injects ld+json structured data
 *  - Generates site/sitemap.xml
 *
 * The client-side JS still runs and replaces static content with the interactive
 * version, so there is no user-facing change.
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
const INDEX_FILE = path.join(SITE_DIR, 'index.html');
const SITEMAP_FILE = path.join(SITE_DIR, 'sitemap.xml');

const SITE_URL = 'https://tellmesomethingidontknow.fyi';

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
    'anglo-zanzibar war': '\u2694\uFE0F',
};

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
    return `
            <span class="emoji">\u{1FAB4}</span>
            <span id="callout-text">${jCount} out of ${total} responses mentioned jellyfish (${pct}%). The immortal jellyfish is apparently the default "interesting fact" in LLM training data.</span>`;
}

function calcOriginality(model: Model, topTopics: string[]): number {
    let runsWithTopTopic = 0;
    for (const run of model.runs) {
        if (!run.success || !run.topics) continue;
        if (run.topics.some(t => topTopics.includes(t))) runsWithTopTopic++;
    }
    return 3 - runsWithTopTopic;
}

function originalityBadge(score: number): string {
    const filled = '\u2605'.repeat(score);
    const empty = '\u2606'.repeat(3 - score);
    return `<span class="originality-badge" data-score="${score}">${filled}<span class="star-empty">${empty}</span> original</span>`;
}

function renderHeroQuote(data: Data): string {
    // Deterministic: use the first model's first successful run
    for (const model of data.models) {
        for (let i = 0; i < model.runs.length; i++) {
            const run = model.runs[i];
            if (!run.success || !run.content) continue;
            const boldMatch = run.content.match(/\*\*([^*]+)\*\*/);
            const snippet = boldMatch
                ? boldMatch[1]
                : run.content.split(/[.!?]/)[0].replace(/^#+\s*/, '').trim();
            if (snippet.length > 10) {
                return `<blockquote id="hero-text">${escapeHtml(snippet)}</blockquote>
        <span class="hero-attr">
            <span id="hero-model">\u2014 ${escapeHtml(model.name)}, Run ${i + 1}</span>
            <a class="hero-refresh" id="hero-refresh">another one</a>
        </span>`;
            }
        }
    }
    return '';
}

function renderModelCards(models: Model[], topTopics: string[]): string {
    let html = '';
    for (let idx = 0; idx < models.length; idx++) {
        const model = models[idx];
        const licenseClass = model.license;
        const licenseLabel = model.license.replace('-', ' ');
        const runs = model.runs;
        const totalTokens = runs.reduce((sum, r) => sum + (r.tokens_completion || 0), 0);
        const originality = calcOriginality(model, topTopics);

        // Tabs
        const tabsHTML = runs.map((_, i) =>
            `<button class="response-tab ${i === 0 ? 'active' : ''}" data-run="${i}">Run ${i + 1}</button>`
        ).join('');

        // Response content (only first run visible by default)
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
                    <summary>show reasoning \u00b7 ${run.tokens_reasoning ?? '?'} tokens</summary>
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

        const allTopics = [...new Set(runs.flatMap(r => r.topics || []))].join(',');
        const releasedHTML = model.released
            ? `<div class="model-released">${escapeHtml(model.released)}</div>`
            : '';

        html += `
            <div class="model-card" data-license="${escapeHtml(model.license)}" data-topics="${escapeHtml(allTopics)}" data-sort-tokens="${totalTokens}" data-originality="${originality}" data-index="${idx}">
                <div class="card-header">
                    <div>
                        <div class="model-name">${escapeHtml(model.name)}</div>
                        <div class="model-provider">${escapeHtml(model.provider)}</div>
                        ${releasedHTML}
                    </div>
                    <div style="text-align: right;">
                        <span class="license-tag ${licenseClass}">${licenseLabel}</span>
                        ${originalityBadge(originality)}
                    </div>
                </div>
                <div class="response-tabs">${tabsHTML}</div>
                ${responsesHTML}
            </div>`;
    }
    return html;
}

function buildLdJson(data: Data): string {
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Tell Me Something I Don\'t Know — LLM Edition',
        description: `I've asked ${data.meta.total_models} LLMs 'Tell me something I don't know.' Most of them said jellyfish.`,
        url: SITE_URL,
        author: {
            '@type': 'Person',
            name: 'Aviv Dozorets',
            url: 'https://x.com/themoah',
        },
        dateModified: data.meta.generated_at,
    };
    return `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

function buildSitemap(lastmod: string): string {
    const date = lastmod.split('T')[0]; // YYYY-MM-DD
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`;
}

async function main() {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const data: Data = JSON.parse(raw);
    let html = await fs.readFile(INDEX_FILE, 'utf-8');

    const modelCount = String(data.meta.total_models);
    const dateStr = new Date(data.meta.generated_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    // 1. Update model count in subtitle
    html = html.replace(
        /(<strong id="model-count">)[^<]*(<\/strong>)/,
        `$1${modelCount}$2`,
    );

    // 2. Update meta description & OG tags with actual model count
    html = html.replace(
        /I've asked \d+\+ LLMs/g,
        `I've asked ${modelCount}+ LLMs`,
    );

    // 3. Update twitter description too
    html = html.replace(
        /(twitter:description" content="I've asked )\d+\+/,
        `$1${modelCount}+`,
    );

    // 4. Update temperature
    html = html.replace(
        /(<strong id="meta-temp">)[^<]*(<\/strong>)/,
        `$1${data.meta.temperature}$2`,
    );

    // 5. Update generated date
    html = html.replace(
        /(<strong id="meta-date">)[^<]*(<\/strong>)/,
        `$1${dateStr}$2`,
    );

    // 6. Replace loading spinner with pre-rendered model cards
    //    Use function replacer to avoid $N backreference issues in content
    const topTopics = Object.keys(data.stats.topic_frequency).slice(0, 3);
    const cardsHtml = renderModelCards(data.models, topTopics);
    html = html.replace(
        /(<div id="model-grid" class="model-grid">)[\s\S]*?(<\/div>\s*<\/section>)/,
        (_, p1, p2) => `${p1}${cardsHtml}\n        ${p2}`,
    );

    // 6b. Pre-render hero quote
    const heroContent = renderHeroQuote(data);
    if (heroContent) {
        html = html.replace(
            /(<section class="hero-quote" id="hero-quote">)[\s\S]*?(<\/section>)/,
            (_, p1, p2) => `${p1}\n        ${heroContent}\n    ${p2}`,
        );
    }

    // 7. Inject topic bars
    const topicBarsHtml = renderTopicBars(data.stats);
    html = html.replace(
        /(<div id="topic-bars" class="topic-bars">)<\/div>/,
        (_, p1) => `${p1}${topicBarsHtml}</div>`,
    );

    // 8. Inject jellyfish callout content and make visible
    const calloutContent = renderJellyfishCallout(data.stats);
    if (calloutContent) {
        html = html.replace(
            /<div id="jellyfish-callout" class="jellyfish-callout" style="display:none">/,
            `<div id="jellyfish-callout" class="jellyfish-callout">`,
        );
        html = html.replace(
            /(<div id="jellyfish-callout" class="jellyfish-callout">)\s*<span class="emoji">.*?<\/span>\s*<span id="callout-text"><\/span>/s,
            (_, p1) => `${p1}${calloutContent}`,
        );
    }

    // 9. Inject ld+json structured data
    html = html.replace(
        '<!-- LD_JSON_SLOT -->',
        buildLdJson(data),
    );

    // Write updated HTML
    await fs.writeFile(INDEX_FILE, html, 'utf-8');
    console.log(`Rendered ${data.models.length} model cards into index.html`);

    // Write sitemap
    await fs.writeFile(SITEMAP_FILE, buildSitemap(data.meta.generated_at), 'utf-8');
    console.log(`Generated sitemap.xml`);

    console.log('Done!');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
