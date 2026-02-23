# tell-me-something-i-dont-know

Ask 25+ LLMs the same question — *"Tell me something I don't know."* — and compare what they say.

Live at **[tellmesomethingidontknow.fyi](https://tellmesomethingidontknow.fyi)**

## How it works

- `build/models.yaml` — whitelist of models (commercial, open-weights, open-source)
- `npm run query` — queries all models via OpenRouter, writes `site/data.json`
- `site/data.json` is committed; Cloudflare Pages deploys it statically
- GitHub Actions runs weekly to discover new popular models and append them to the YAML

## Local usage

```bash
export OPENROUTER_API_KEY="sk-or-..."
npm run query          # fetch fresh responses from all models
npm run update-models  # discover + append new popular models
npm run preview        # serve site locally
```
