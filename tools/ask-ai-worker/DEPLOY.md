# pulse-ask-ai — Workers AI backend for the board's "Ask AI" panel (PREPARED, NOT DEPLOYED)

A separate Worker. It does not touch `kalshi-relay`. No external API key exists anywhere: the model runs through the Workers AI **binding** on your own Cloudflare account.

## What it enforces
| Protection | How |
|---|---|
| Only the board can call it from a browser | CORS allows only `https://rydawg2026.github.io`; requests with another/missing `Origin` get 403 |
| `POST /ask` only (+ `OPTIONS` preflight, `GET /healthz`) | everything else 404/405 |
| Small requests | JSON only, body ≤ 14,000 bytes, question ≤ 600 chars, snapshot ≤ 6,000 chars, ≤ 6 history turns × 700 chars |
| Per-IP burst limit | Workers **Rate Limiting binding** `IP_LIMITER`: 5 requests / 60 s (approximate, per Cloudflare location) |
| Per-IP + global **daily caps** | SQLite Durable Object `AskLimiter` (strongly consistent): 15 questions/day per IP (hashed with the UTC date, never stored raw), **50/day for everyone** |
| Free-tier ceiling | 50 × worst case ≈ 179 neurons = 8,950 < 10,000 free neurons/day (see maths below). Failed AI calls are refunded against the cap |
| Streaming | the model's stream is normalised to `data: {"t":"…"}` events then `data: {"done":true,"model":"…"}`; reasoning tokens are dropped |
| Privacy | question text is not stored or logged |
| Kill switch | set var `ENABLED=false` → 503; the page then falls back to built-in answers |

## Model choice (from Cloudflare's docs, read 2026-11-12)
* **Primary: `@cf/openai/gpt-oss-120b`** — OpenAI open-weight reasoning model, 128k context, function calling, reasoning levels low/medium(default)/high, `messages` + `stream:true` supported. **Not** on Cloudflare's "requires Workers Paid / prepaid credits" list, so it runs on the **free** allocation.
* **Fallback: `@cf/google/gemma-4-26b-a4b-it`** — Google Gemma 4, 256k context, reasoning, ~3.5× cheaper in neurons. Used only if the primary call errors (e.g. capacity).
* Why not "stronger" ones: `glm-5.3`, `deepseek-v4-pro-0813`, `kimi-k2.6/2.7-code`, `inkling-2-small` etc. are on the **paid-only** list (Workers Paid $5/mo or prepaid AI Gateway credits; on Free they return 403 / error 5035). They are bigger/newer, so they'd likely answer better, but they can't run on the free tier. `nemotron-3-120b-a12b` is free-eligible but marked "Planned deprecation 11/20/2026", so I did not choose it.
* To change models later, set the `MODEL` / `FALLBACK_MODEL` vars; nothing else changes.

## Free tier, limits and cost (Cloudflare pricing page "last updated Nov 12, 2026" and limits page)
* Workers AI price: **$0.011 per 1,000 Neurons**. **10,000 Neurons/day free on both Workers Free and Workers Paid**, resetting 00:00 UTC. On Workers Free, going over makes requests fail with an error (no charge). Paid plan bills the overage.
* `gpt-oss-120b`: 31,818 neurons per M input tokens, 68,182 per M output tokens (= $0.35 / $0.75 per M tokens). `gemma-4-26b-a4b-it`: 9,091 / 27,273 neurons per M (= $0.10 / $0.30).
* Rate limit for text generation: 300 requests/minute per account for non-paid-only models.
* **My per-question estimate** (assumes ~4 chars/token — an estimate, not a measurement): typical ≈ 1,400 input + 650 output tokens (reasoning tokens count as output) ≈ 44 + 44 ≈ **89 neurons ≈ $0.001**, i.e. ~110 questions/day free. Worst case (max sizes) ≈ 3,500 in + 1,000 out ≈ 111 + 68 ≈ **179 neurons ≈ $0.002**. The 50/day cap keeps even the worst case under the free 10,000. If you remove the cap and go past free on Workers Paid: ~1,000 typical questions ≈ **$1**.
* The 10,000 neurons are per **account**: anything else on the account using Workers AI draws from the same pool.
* Paid-model upgrade (not default): `glm-5.3` is $1.40/$4.40 per M tokens ≈ **$0.005 per typical question**; `deepseek-v4-pro-0813` $1.32/$3.96 ≈ **$0.0044**. Needs Workers Paid ($5/month) or credits, and those paid-only models are limited to 20 requests/min/account (50 with prepaid credits).
* **Premium outside model (not built):** calling xAI / OpenAI / Anthropic would need *your own* API key stored as a Worker secret (`wrangler secret put …`), pay-per-use billed by that vendor (I have not quoted their prices — check their pricing pages). The Worker's contract with the page would stay identical; only the `env.AI.run` call would change. I did not create any account or key.

## Exact deploy step (needs your go; I have NOT run any of this)
1. `cd tools/ask-ai-worker && npx wrangler deploy` (uses `wrangler.toml`: Workers AI binding, rate-limit binding, SQLite Durable Object migration `v1`, workers.dev URL). Wrangler needs to be logged in to the same Cloudflare account that hosts `kalshi-relay` (`npx wrangler login`, or a scoped `CLOUDFLARE_API_TOKEN`). Alternatively I can upload it through the Cloudflare connector after you say go.
2. Expected URL: `https://pulse-ask-ai.rydawg2026.workers.dev/ask` (same workers.dev subdomain as the relay).
3. Smoke test (one question, uses ~90 neurons):
   `curl -N -X POST https://pulse-ask-ai.rydawg2026.workers.dev/ask -H 'Origin: https://rydawg2026.github.io' -H 'Content-Type: application/json' -d '{"question":"What is a halving?","snapshot":"{}"}'` → expect `data: {"t":"…"}` lines then `data: {"done":true,…}`. **This first live call matters:** Cloudflare's docs don't spell out the exact streaming chunk shape, so the Worker's normaliser accepts the three known shapes (`{response}`, OpenAI chat chunks, Responses events) and I only tested it against mocks of those. If the reply were empty the page would simply fall back to built-in answers, and the normaliser is a ~20-line function to adjust.
4. In `index.html` change `window.ASK_AI_URL=''` to `window.ASK_AI_URL='https://pulse-ask-ai.rydawg2026.workers.dev/ask'`, commit, push (that is the step that turns AI mode on for visitors).
5. Roll-back: set the Worker var `ENABLED=false` (instant), or blank `ASK_AI_URL` again.

## Tests
`node tools/ask-ai-worker/test.mjs` — offline, no network, no neurons: CORS, method/path/origin/content-type/size rejects, caps (per-IP, global, refund on failure), burst limit, model fallback, stream normalisation (three shapes, reasoning dropped), kill switch, no question logging.
