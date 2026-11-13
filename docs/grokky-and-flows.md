# Grokky 1 vs Grokky 2, large-transfers tracker, and the 2026-11-12 reset (branch `grokky-rebuild`)

## Grokky 1 vs Grokky 2 (`grokky.js`)
* Paper-only. Nothing is ever sent to Kalshi; picks live in `localStorage` (`pulseboard.v2` → `groks`).
* Rule: **Grokky 1 = the v2 engine's side** for the window; **Grokky 2 = always the opposite side**. The side is locked as soon as the engine has its call for the window (at window open when the tab is open; otherwise as soon as the page loads, flagged "late lock"). The engine only uses closed candles, so a late lock has no hindsight. Locked rounds are never edited.
* Kalshi's price is ~50¢ right at the open by construction, so it cannot pick a side; it is cited as an agree/disagree note only.
* Rationales are built only from fields that loaded (engine signals, Kalshi price, BRTI gap, order-book imbalance, large-trade flow, OKX funding, OKX liquidations, Fear & Greed). Contrarian readings (funding, liquidations, Fear & Greed) are labelled as readings; earlier backtests found no 15-minute edge in them. If nothing supports Grokky 2's side the card says it is a forced opposite pick. Rationale is frozen once the context feeds are ready (or after 45 s).
* Scoring: when a window shows up as settled in Kalshi's public API (`result`, `expiration_value` vs `floor_strike`), the round is scored: whoever's side matches Kalshi's result wins. No-edge rounds count too (flagged). Rounds Kalshi has not settled yet (or that fell out of the 50-market settled list) stay "awaiting Kalshi settlement".
* Per browser: the tally only advances while a tab is open, and each visitor has their own.

## Large transfers & trades tracker (`flows.js`)
Records items worth ≥ $25,000. Tiers: $25k–100k, $100k–1M, $1M+.
| Feed | What it is | Direction? | Poll |
|---|---|---|---|
| blockchain.info `unconfirmed-transactions` (shared with the whale box) | on-chain transfers in the mempool, USD at the board's price when first seen; amount = sum of outputs incl. change | **none shown** | ~25 s (latest 100 txs ≈ 30 s) |
| Binance (data-api.binance.vision) `aggTrades` paged by `fromId` | exchange trades ≥ $25k | taker side (`m:true` → taker sold) | ~20 s |
| OKX `market/trades` | exchange trades ≥ $25k | taker side as reported | ~20 s (latest 500 trades) |
| OKX liquidation feed (already used by the Market-context box) | forced closes ≥ $25k | long/short position | with that box |
Coinbase trades were skipped on purpose: its `side` field is the maker side, which is easy to misread.
Storage `pulseboard.flows.v1`: latest 1000 items + per-minute totals for ~3 h, so 15 min / 1 h summaries do not depend on the list cap. Each summary shows "partial window" when the page was not watching for the whole span.

## Reset (migration)
`index.html` runs a one-time inline script before anything else: if `pulseboard.cleared.2026-11-12` is not set it removes `pulseboard.v1` (call history, play-money bets and balance, legacy v1 line) and `pulseboard.obook.v1` (old paper order-book log), then sets the flag. New keys: `pulseboard.v2`, `pulseboard.obook.v2`, `pulseboard.flows.v1`. Backfill is off, so history starts empty and only holds calls locked while a tab was open.
