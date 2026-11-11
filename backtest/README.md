# Win-rate investigation + Kalshi panel (branch `winrate-tuning`, NOT deployed)

Data (all public, no keys): 150 days (2026-06-14 → 2026-11-11, 14,401 fifteen-minute windows) of BTC 15m candles from Coinbase, Binance.US,
Binance (data-api.binance.vision) and OKX (Gate.io refused the long-range request, so 4 sources instead of the live page's 9; same median-consensus method),
plus 6,393 settled Kalshi KXBTC15M windows (2026-09-05 → 2026-11-11) used as an independent "what actually settled" label.
The Pulse Board's own live prediction log lives only in Ryann's browser localStorage — it is NOT on the box, so I could not read his real logged calls.
Instead the **exact** v1 engine code (copied verbatim into `engine.js`) was replayed over the real candles, which is what the page's own "backfill" does.

Reproduce: `python3 backtest/fetch_candles.py 150; python3 backtest/fetch_kalshi.py; node backtest/run.js v1 …; node backtest/run.js v2 …; python3 backtest/compare.py`
Results are in `results_*.txt`. Data files are not committed.

## Why v1 loses (real numbers, 14,297 windows)
* v1 hit rate **48.8%** (95% CI 47.9–49.6) — statistically *below* a coin flip. Against Kalshi settlement: 49.8% (n=6,393).
* 5 of its 7 signals are trend/momentum-following; each hits 48.1–49.2% alone. At the 15-minute horizon BTC slightly **gives back** moves, so following them loses.
  Only RSI-extremes (53.7%, n=1,304, the only mean-reversion signal) and the USD/USDT premium (50.9%) were above 50%.
* **Its confidence is backwards**: conf ≥80% calls hit 46.8% (n=5,147); conf <60% hit 51.8%. The stronger the signal, the worse it did (top score quintile 45.7%).
* Losses cluster in **trending stretches** (trendiest quartile 47.4%, choppiest 50.7%) and mid-high volatility (47.2%), exactly when trend-following should work but doesn't here.
* Time of day / weekday: nothing reliable (hours range 44.8–51.8% with CIs ±4 — noise). Inverting v1 would have scored 51.3%.
* No abstain option: it calls every window including coin-flip ones, and always shows 50–99% "confidence".

## v2 (on this branch)
Mean-reversion logistic score on 5 features (1h vol-scaled overshoot, last-candle overshoot, RSI(14), close location in range, USD/USDT premium).
Coefficients fitted **only on windows before 2026-09-25** (train, 9,752 windows) and frozen in `engine.js`; test = 2026-09-25 → 2026-11-11 (4,545 windows, never used for fitting).
"Conviction" = |p−0.5| ≥ train median.

| | v1 (old) | v2 |
|---|---|---|
| Test (out-of-sample), candle label, all calls | 48.7% (n=4,545, CI 47.2–50.1) | **51.8%** (CI 50.3–53.2) |
| Test, v2 conviction calls only | 47.2% on same windows | **53.1%** (n=2,283, CI 51.1–55.2) |
| Test, vs Kalshi settlement label | 49.3% (n=4,496) | **50.4%** (CI 48.9–51.9) — NOT distinguishable from 50% |
| Test, v2 conviction vs Kalshi label | | 51.6% (n=2,254, CI 49.5–53.6) |
| Train (in-sample) | 48.8% | 51.8% |
| Longest losing streak (test) | 13 | 10 |

Honest read: the improvement is real against candle direction (+3.1 pts OOS, one-sided p≈0.009 vs 50%) but small, and it mostly **does not carry over to Kalshi's own settlement**
(Kalshi settles on a 60-second average vs the window's opening price; candle-direction and Kalshi labels agree only 93.8% of the time). Expect ~50–52% wins, long losing streaks, and no profit after fees.
v2's displayed confidence is its model probability (~50–56%), which is calibrated to that reality, instead of v1's 50–99%.

## Kalshi panel
`kalshi.js`: public read-only API `GET /markets?series_ticker=KXBTC15M…`, `/series/KXBTC15M/markets/{ticker}/candlesticks`. No keys, no orders.
**CORS**: Kalshi answers browser requests from github.io with HTTP 403 and no `Access-Control-Allow-Origin` (it only allows kalshi.com), so a static page cannot call it directly (confirmed with curl and in headless Chromium).
Workarounds: `tools/kalshi-proxy-worker.js` (free Cloudflare Worker, GET-only, allow-listed to KXBTC15M, CORS locked to the Pages origin — proposal, not deployed) or `tools/kalshi_snapshot.py` + a scheduled job writing `kalshi-snapshot.json` (panel shows its age). Local preview emulates the Worker: `python3 tools/preview_server.py 8765` → `http://127.0.0.1:8765/?kalshi=/kalshi-proxy`.

## Extra edges tested on real data
See `results_edges.txt`: Binance spot taker-buy imbalance (CVD proxy) and OKX perp funding add nothing out-of-sample (fade-the-flow 50.9–51.3%, inside noise; adding to the model *lowered* test hit 51.3→50.8%).
