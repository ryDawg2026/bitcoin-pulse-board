# The callers (Zippy, Mellow, Ripple), price-action indicators and Grokky learning

Paper only: no money, no Kalshi orders, no keys. Everything runs in the browser; the only new storage keys are `pulseboard.callers.v1` and `pulseboard.learn.v1`. Existing keys (`pulseboard.v2`, `obook.v2`, `flows.v1`, `sig.v1`, the migration flag) are never cleared or migrated; the tests prove callers never write them.

## Cadence
Each 15-minute Kalshi window is split into 4-minute blocks. At **minute 4, 8 and 12** each caller makes one call (UP or DOWN for that window) and "backs" Grokky 1 or Grokky 2. A mark fires if the page is open within **90 s** after it; otherwise it is recorded as *missed* and never back-filled. Opening the page mid-window therefore only gets the later marks.

## "Backs" is determined by the call
Grokky 2 always takes the opposite side of Grokky 1, so a call on Grokky 1's side backs Grokky 1 and the other side backs Grokky 2. The UI says so. Backing is scored like the call (backed Grokky wins iff the call was right) and each caller shows how its "G1" and "G2" backings fared.

## All three callers are equally capable (explicit)
* **Same inputs:** one shared reading vector (`indicators.js`) + Grokky 1/2's picks, reasons, engine lean, and the Kalshi strike/price. Each mark stores that vector once for all three.
* **Same function:** one `decide(leans, profile)` — mean vote per evidence group, weighted sum, `p = sigmoid(4·score)`.
* **Same reasoning depth:** the same five evidence groups and the same written trail ("Why?" with the weighted breakdown, "What else I considered" with opposing readings, alternatives such as *lens-only* / *ignoring the Grokkys* / *strike-only*, what the others called, what couldn't be read).
* **They differ only in weighting style.** Every profile spends a weight budget of exactly **1.00**; *distance-to-strike & crowd* is **0.30** and *Grokky evidence* **0.10** for all:

| caller | style | trend | bounce-back | order flow | strike & crowd | Grokky evidence |
|---|---|---|---|---|---|---|
| Zippy | momentum | **.38** | .08 | .14 | .30 | .10 |
| Mellow | mean-reversion | .08 | **.38** | .14 | .30 | .10 |
| Ripple | order-flow | .08 | .08 | **.44** | .30 | .10 |

e2e asserts equal budgets, equal strike/Grokky weights, identical input keys, and that the styles flip with the evidence (so none is a "dumb" copy). Later marks are naturally easier (less time left, so distance-to-strike dominates); the scoreboard splits accuracy by mark so this is visible rather than hidden.

## Indicators (`indicators.js`), all free, no key, CORS-friendly
Computed from two public candle feeds, polled every 20 s, plus data the board already has:
* **Coinbase BTC-USD 1-minute candles** (`api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60`) → price, VWAP (1 h), EMA 5 vs 20 cross, RSI(14), ATR(14) & 1-minute volatility, last-5-candle momentum, stretch from the 30-min average, move since window open.
* **Binance BTCUSDT 1-minute klines** (`data-api.binance.vision`, field 9 = taker-buy volume) → **CVD** (taker-buy − taker-sell, last 15 min); with Coinbase → **Coinbase-vs-Binance premium** (z-score vs its own last hour, so the permanent USD/USDT basis cancels).
* **Distance to strike** in typical remaining swings (1-min σ × √minutes left) *and* in ATRs, with a rough "chance to finish above/below"; **realized vs implied move** (Kalshi's price → implied σ, derived, labelled as such); Kalshi crowd price; Kalshi book imbalance (existing Market-context reading); the Grokkys' own evidence balance and engine lean.
Every reading is `{vote −1…+1, desc quoting the live numbers}`; a reading that can't be computed says why (`na`) and is ignored, never invented. Grokky 1/2 also receive the price-action readings as extra evidence (`src:'ind'`).

## Check & balance
Summary first ("3 of 5 of us say ▲ UP", two agreement meters, where we all agree / where we split); tap for the reading-by-reading grid: each reading's lean × Grokky 1, Grokky 2, Zippy, Mellow, Ripple (✓ agrees / ✗ goes against) plus "right so far" (how often that reading's lean matched Kalshi at the callers' marks; fills in as rounds settle).

## Grokky learning (`pulseboard.learn.v1`)
For every settled round each stored reading is credited right/wrong. Trust multiplier = `1 + 2·(accuracy − 50%)`, accuracy smoothed with a 50% prior worth 10 rounds, **bounded 0.7×–1.3×, and only after a reading has been seen in 20 settled rounds**. Only Grokky 1's pick can move, only through the engine's own signal weights; if learning flips the side it is recorded (`rec.learn`) and the Why? trail says so. Grokky 2 is still always opposite Grokky 1. Both show a "🌱 What I've learned" note.

## Limitations
* Marks only count while the page is open; the learning/scoring is per browser.
* Probabilities ("rough chance") are model outputs, not calibrated; earlier backtests found little 15-minute edge in most of these readings. Small samples in "right so far".
* Storage: each callers round keeps one shared vector per mark (~6 KB/round, newest 90 rounds); totals persist separately. `pulseboard.v2` (Grokky rounds with trails) is the larger user of the ~5 MB localStorage budget.
* The deployed Ask AI Worker prompt is unchanged; the page now also sends a compact `callers` summary in the snapshot (treated as data).
