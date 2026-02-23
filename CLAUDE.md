# tell-me-something-i-dont-know

## Running scripts
- `npm run query -- --dry-run` — preview all models without making API calls
- `npm run query -- --append` — skip models already in `site/data.json`
- `npm run update-models` — discover + append new models to `build/models.yaml`
- API key lives in `.env` (gitignored); source with `source .env` or `export OPENROUTER_API_KEY=...`

## Key rules
- `build/models.yaml` is **append-only** — never remove or modify existing entries; raw text append preserves comments
- Models with `:` in their OpenRouter ID (`:free`, `:nitro`, `:extended`) are provider variants — skip them
- `site/data.json` is committed to git; Cloudflare Pages deploys it statically (no build step)
- Website runs on **Cloudflare Pages** — all features must be supported by it (static hosting, no server-side rendering, no edge functions required)

## OpenRouter API
- Models list: `GET https://openrouter.ai/api/v1/models` — returns all 300+ models, no popularity sort
- Rankings page (`/rankings`, `/models?order=most-popular`) is a React SPA — not scrapable with plain fetch; use the API instead
- Rankings page `__NEXT_DATA__` extraction is attempted but often absent; fall back to full model list

## TypeScript / Node.js
- Project uses ESM (`"type": "module"`) — `__dirname` not available; use `path.dirname(fileURLToPath(import.meta.url))`
- Scripts run with `tsx` directly, no compilation step needed
