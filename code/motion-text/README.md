# Motion-defined text: prototype + adaptive attack

The standalone prototype from note [02](../../02-motion-defined-text-adaptive-attack.md). It never touched HIM production.

| File | What it does |
|---|---|
| `lib.mjs` | Lays out the card, builds the private glyph mask and the seeded dot field |
| `server.mjs`, `client.html` | Streams one occupancy bitmap per frame over a WebSocket; the browser only paints dots |
| `decoder.mjs` | **The attack**: cross-correlates frames, integrates K pairs and renders the hidden text |
| `capture.mjs` | Builds the red-team set: real headless-Chrome canvas captures plus decoder outputs |
| `bot2.mjs` | Socket-reading integrator at K = 40, plus a binarised variant |
| `redteam.mjs` | Sends each capture mode to Claude Haiku 5.5 / Sonnet 5.5 on Amazon Bedrock and scores the answers |
| `bench.mjs` | Bandwidth and CPU at 1, 25 and 100 concurrent streams |

```bash
npm install                       # needs a local Chrome/Chromium for playwright-core
node server.mjs                   # watch it: http://127.0.0.1:8765/?demo=1
node capture.mjs 16               # uses sample-questions.json (or QUESTIONS=your.json)
export AWS_BEARER_TOKEN_BEDROCK=...   # your own key, from the environment only
node redteam.mjs --model haiku --n 16
```

The published numbers used 40 questions from HIM's private bank. `sample-questions.json` is a small generic set written for this repo, so expect wider confidence intervals.
