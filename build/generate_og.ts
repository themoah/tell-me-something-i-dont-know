#!/usr/bin/env tsx
/**
 * Generate a simple OG image (1200x630) for social previews.
 * Uses @napi-rs/canvas to draw text on the site's dark background.
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(__dirname, '..', 'site', 'og.png');

const WIDTH = 1200;
const HEIGHT = 630;
const BG = '#0c0b0e';
const ACCENT = '#f0c040';
const TEXT = '#e8e4de';
const TEXT_DIM = '#8a8690';

async function main() {
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

    // Tagline
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '28px monospace';
    ctx.fillText('Most of them said jellyfish.', 80, 440);

    // Jellyfish emoji placeholder (text)
    ctx.fillStyle = ACCENT;
    ctx.font = '120px serif';
    ctx.fillText('\u{1FAB4}', 920, 350);

    const buf = canvas.toBuffer('image/png');
    await fs.writeFile(OUTPUT, buf);
    console.log(`Generated ${OUTPUT} (${buf.length} bytes)`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
