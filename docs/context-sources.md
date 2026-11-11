# Market-context sources (researched 2026-11-11; branch `market-context`, not deployed)
All are free, no key. "CORS" = works from https://rydawg2026.github.io in a browser (tested with that Origin header). These are CONTEXT only — earlier backtests found news, whale flows and funding do not predict 15-minute moves beyond Kalshi's own price, and none of this feeds `engine.js`.

| Rank | Item | Source | CORS | Status in the board |
|---|---|---|---|---|
| 1 | Settlement gap (BRTI 60-s average vs floor_strike, time left) | Kalshi `GET /live_data/events/{event_ticker}` (series' last point == final settlement value; verified on a settled market) | needs our Worker (Kalshi blocks github.io) | built; Worker route pending approval |
| 2 | Kalshi KXBTC15M order-book depth / imbalance | Kalshi `GET /markets/{ticker}/orderbook?depth=10` | needs our Worker | built; Worker route pending approval |
| 3 | Scheduled macro events + sit-out warning | Official schedules: bls.gov (CPI, jobs), federalreserve.gov (FOMC) — static table | n/a (no network) | built |
| 4 | Volatility regime | board's own consensus candles + Deribit DVOL `public/get_volatility_index_data` | yes | built |
| 5 | Liquidations | OKX `public/liquidation-orders` (+ `public/instruments` for contract size). Binance `fapi` = HTTP 451 (geo-block), Bybit = 403, BitMEX = 403, Bitfinex has no CORS | OKX yes | built (OKX BTC-USDT only; REST returns only latest events) |
| 6 | Funding rate, open interest | OKX `public/funding-rate`, `public/open-interest`; Deribit `get_book_summary_by_currency` also works | yes | built (OKX) |
| 7 | News headlines | rss2json relay of Cointelegraph + Decrypt RSS (direct RSS has no CORS); fallback Hacker News Algolia API. Blockchair `/news` has CORS but its newest item was Aug 2026 (stale) — rejected. CryptoCompare news now needs a key; CoinDesk RSS 429 | rss2json yes (free tier is rate-limited; may return 429), HN yes | built, shows "stale"/"unavailable" honestly |
| 8 | Whale transfers | blockchain.info `unconfirmed-transactions` (>= 100 BTC); mempool.space also CORS-open | yes | built. Exchange inflow/outflow labels need paid data (Glassnode, CryptoQuant, Whale Alert) — not available free |
| 9 | Fear & Greed (daily) | alternative.me `/fng/` | yes | built |
| 10 | Coinbase / USD-vs-USDT premium | computed from the board's own sources | n/a | built |
| — | Spot ETF daily flows | farside.co.uk (HTML only, no CORS/API) | no | not built |
| — | Economic calendar API | faireconomy `ff_calendar_thisweek.json` works but has no CORS (would need a relay) | no | not built; static official table used instead |

Tested and NOT predictive (see `backtest/results_edges.txt`): Binance taker-buy flow, OKX funding.
