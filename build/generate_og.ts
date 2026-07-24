#!/usr/bin/env tsx
/**
 * Generate a simple OG image (1200x630) for social previews.
 * Uses @napi-rs/canvas to draw text on the site's dark background.
 */

import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { topTopic, topTopicClaim, topicEmoji } from './render_site.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(__dirname, '..', 'site', 'og.png');
const DATA_FILE = path.join(__dirname, '..', 'site', 'data.json');

const WIDTH = 1200;
const HEIGHT = 630;
const BG = '#0c0b0e';
const ACCENT = '#f0c040';
const TEXT = '#e8e4de';
const TEXT_DIM = '#8a8690';

async function main() {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw) as { stats: { topic_frequency: Record<string, number>; total_responses: number; total_models: number; total_tokens: number; total_reasoning_tokens: number } };
    const claim = topTopicClaim(data.stats);
    const topic = topTopic(data.stats);
    const emoji = topic ? topicEmoji(topic) : '\u{1FAB4}';

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle accent line at top
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, WIDTH, 4);

    // Title line 1
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 64px serif';
    ctx.fillText('Tell Me Something', 80, 200);

    // Title line 2 (accent)
    ctx.fillStyle = ACCENT;
    ctx.font = 'italic bold 64px serif';
    ctx.fillText("I Don't Know", 80, 280);

    // Subtitle
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '32px monospace';
    ctx.fillText('LLM Edition', 80, 340);

    // Tagline — wrap if long
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '26px monospace';
    const maxWidth = 780;
    if (ctx.measureText(claim).width <= maxWidth) {
        ctx.fillText(claim, 80, 440);
    } else {
        const words = claim.split(' ');
        let line = '';
        let y = 420;
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width > maxWidth && line) {
                ctx.fillText(line, 80, y);
                line = word;
                y += 36;
            } else {
                line = next;
            }
        }
        if (line) ctx.fillText(line, 80, y);
    }

    // Top-topic emoji
    ctx.fillStyle = ACCENT;
    ctx.font = '120px serif';
    ctx.fillText(emoji, 920, 350);

    const buf = canvas.toBuffer('image/png');
    await fs.writeFile(OUTPUT, buf);
    console.log(`Wrote ${OUTPUT}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
