# Callers v2 — six callers, confidence, memory, phases, the Grokky Archive, crowd and the volatility gate

Everything here is **paper only**: no money, no Kalshi orders, ever. Branch `callers-v2` (off `main` at `d50fc29`). Nothing is pushed to `main`.

## The beats (one table: `BEATS` in `callers.js`)

| Caller | Style | Beats (min:sec into the 15-min window) |
|---|---|---|
| Dash | aggressive early (momentum + volume) | 1:00 · 6:00 · 11:00 |
| Zippy | momentum | 2:00 · 7:00 · 12:00 |
| Mellow | volume (surges, CVD, taker-buy share, a little bounce-back) | 3:00 · 8:00 · 13:00 |
| Ripple | chart structure (EMA cross, VWAP, RSI, support/resistance, candles) | 4:00 · 9:00 · 14:00 |
| Sage | conservative confirmation (strike gap + crowd weigh most) | 5:00 · 10:00 · **14:30** |
| Flippy | late-flip gambler (see below) | **14:15 only** |

* 16 beats, all unique, never two callers in the same second (tested).
* **Minute 15 is settlement**, so Sage's third call cannot be at 15:00. It is at **14:30** (870 s). To change it, edit `BEATS.sage[2]` (one number, seconds); everything (timeline, chips, grace, tests' expectation text) follows. Flippy's 14:15 = `BEATS.flippy[0]` (855 s); 13:30 = 810 s is also free.
* Grace: a beat fires only if the page is open within `min(45 s, 895 − beat)` of it (Sage 25 s, Flippy 40 s). Otherwise it is recorded as **missed**; nothing is back-filled.
* **Equal capability**: Dash/Zippy/Mellow/Ripple/Sage read the same shared vector (`indicators.js`) plus the Grokkys' picks, and run the same `decide()` / `confidence()` / memory code. Only their weights differ (each totals 1.00 over seven groups):

| | momentum | volume | chart | revert | flow | strike | grokky | K | confidence × |
|---|---|---|---|---|---|---|---|---|---|
| Dash | .26 | .20 | .12 | .04 | .08 | .20 | .10 | 6 | 1.08 |
| Zippy | .36 | .06 | .06 | .04 | .08 | .30 | .10 | 4 | 1.00 |
| Mellow | .06 | .36 | .06 | .08 | .04 | .30 | .10 | 4 | 1.00 |
| Ripple | .06 | .06 | .36 | .08 | .04 | .30 | .10 | 4 | 1.00 |
| Sage | .10 | .12 | .14 | .06 | .08 | .40 | .10 | 3 | 0.92 |

Each also "backs" Grokky 1 or 2 (Grokky 2 is always the opposite of Grokky 1, so backing follows the call).

## Indicators (all free, CORS-friendly, no keys — Coinbase + Binance candles, Kalshi)
momentum: 5-candle momentum, 15-minute momentum, acceleration (last 2 min vs the 2 before), move since window open · volume: surge vs the hour's median, CVD, taker-buy share · chart: EMA 5/20 cross, VWAP, RSI(14), support/resistance (1-hour swing high/low in ATRs), candle shape (hammer, shooting star, strong body, engulfing) · revert: stretch from 30-min average, last-3-minute overshoot · flow: Coinbase-vs-Binance premium, Kalshi order book · strike: distance to strike (σ and ATR units), Kalshi crowd price · grokky: the Grokkys' readings and engine lean · info: ATR, realized vs implied move.

## Confidence (0–100) — `confidence()`
`conf = clamp(5..95, round((55·strength + 30·agreement + 15·coverage + crowdNudge) × gate × temperament))`
* strength = min(1, |score| / 0.5); agreement = weight share of evidence groups (with a view) that side with the call; coverage = groups readable / 7;
* crowdNudge = ±8 from how many *earlier callers this window* agree (only if ≥ 2 called; it moves confidence, never direction; Flippy is not counted as a consensus vote);
* gate = ×0.75 on a caution; temperament = Dash 1.08, Sage 0.92.
Every driver is stored on the call and shown in the "Why?" trail in plain words.

## Short memory (last 5 settled calls per caller)
If an evidence group leaned the wrong way (|lean| ≥ 0.15) in **both** of a caller's last 2 settled calls, its weight is damped ×0.7 for the next call (weights are renormalised), until it is right again. The call stores `damp:[{g,f,why}]` and the Why trail says so. Skipped calls are never remembered.

## Extensive memory with market phases
* Per caller, per phase: record, per-beat record, per-group hit rates. After ≥ 15 readings of a group in the phase, a bounded trust multiplier (0.8–1.2) applies (`(hits+4)/(n+8)`), shown in the trail.
* **Phase** = volatility regime × trend regime from the live candles: volatility `wild` (ATR > 1.6× its median) / `calm` (< 0.6×) / `normal`; trend `up` / `down` (|1-hour move| > 1.5σ) / `range`. A change must **hold 10 minutes** and the phase must be **≥ 30 minutes old** before a new phase starts (no flicker). The reason is written in plain words.
* **Manual**: "Start a new phase" button (asks to confirm). On a new phase, per-phase stats reset (a summary goes to the phase history, last 12 kept); all-time totals, short memory and the Archive are untouched. The current phase and its start time are always shown. Calls made in an older phase are still scored in the totals but not counted in the new phase.

## Mark tallies (minute 4, 8, 12)
Each caller's standing (all-time and this-phase record of settled calls) is snapshotted once at minute 4, 8 and 12 (within 45 s of the mark) and frozen. Per-beat accuracy (1st/2nd/3rd beat) sits alongside in the scoreboard.

## Crowd layer
Each call stores how many earlier callers in the window agreed. A live strip shows "N of M callers so far say UP" and the historical share of past calls with that direction in **similar conditions** (bucket = volatility regime × price above/below strike × early/mid/late beat; needs n ≥ 8, shown with n) and how often they were right.

## Volatility gate (`PulseIndicators.GATE`)
Triggers: (1) last closed candle's range > **3×** its recent ATR; (2) realized volatility (sd of the last 5 returns) > **2×** its median; (3) price crossed the strike **≥ 2 times** in the last 3 minutes.
* One trigger → **caution** badge (⚠), confidence ×0.75, still scored.
* Two or more triggers, or a candle > **5×** ATR → **"skipped: too fast"**: a record with no direction, not scored, not remembered, never a loss.
* Flippy is exempt from skipping (fast tape near the strike is what he hunts) but shows the gate reading.

## Flippy — the late-flip gambler
Only calls when he is **highly confident (≥ 70/100)** that price is about to cross the strike **against the current leader** (leader = side price is on right now); otherwise he sits out: **"no flip seen"**. Sitting out is never a loss.
Flip score (= his confidence), seven evidence parts: distance to strike in ATRs (30), late momentum against the leader (18), acceleration (10), CVD / taker-buy swing (12), order-book shift (8), Kalshi crowd price moving since the window's first call (10), how similar setups flipped before in this phase (12).
Memory: (a) setup history per phase — bucket = leader side × distance band × momentum-against × volatility regime; every window (call **or** sit-out) records whether a flip actually happened, so he gets bolder where flips kept coming and quieter where none did (starting guess 25%, `(hits+1)/(n+4)`); it resets on a new phase; (b) pickiness — each miss among his last 2 settled flip calls raises his bar by 5.
Scoreboard: flip calls made, hit rate, and how often he was right to sit out (no flip came).

## Grokky Archive (benchmark) — `archive.js`, key `pulseboard.archive.v1`
Never forgets, never changes, never feeds back. It permanently logs every call/sit-out of every caller (compact rows), both Grokkys' picks, and Kalshi's result, and runs its own **fixed** benchmark at minute 4/8/12 (equal weight on every group; no memory, damping, phases or learning). Shown only as a comparison scoreboard. Isolation: it receives data one way (`logCall`, `observeG`, `settle`, `tick`), it is read into memory once at start-up, and no decision code reads it or its key; tests prove a corrupt or hugely "winning" archive leaves live calls byte-identical. Size is bounded (900 KB): beyond that the oldest round rows are dropped with a visible note; all-time totals keep counting every round.

## Storage
New: `pulseboard.callers.v2`, `pulseboard.archive.v1`. **Read-only:** `pulseboard.callers.v1` (the first three callers; shown as "Archived"). Never touched: `pulseboard.v2`, `obook`, `flows`, `sig`, `learn`. Tested byte-for-byte.

## Decisions to confirm
Sage's 14:30 and Flippy's 14:15 · gate thresholds (3× / 2× / 2 crossings / 5×) · phase thresholds (1.6× / 0.6× / 1.5σ, hold 10 min, min age 30 min) · Flippy's bar (70, +5 per recent miss) and his gate exemption · archive cap (900 KB) · names Dash, Sage, Flippy.
