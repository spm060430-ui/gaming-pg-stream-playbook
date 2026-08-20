# TradingView → Tradovate micro-futures swing bot

A fully-automated **swing** trading system for **micro futures** — **MNQ** (Micro
E-mini Nasdaq-100) and **MGC** (Micro Gold). The strategy lives in **Pine Script
on TradingView** (native backtesting + paper trading + live alerts); a small
**Python relay** applies an independent risk/circuit-breaker layer and places
real orders on **Tradovate**. A separate Python **backtester** mirrors the Pine
logic for offline research.

```
 TradingView (Pine strategy)                 Python (this repo)
 ┌──────────────────────────┐   webhook   ┌──────────────────────────────┐
 │ EMA10/30 cross + RSI      │  ────────▶  │ relay: validate + dedupe     │
 │ ATR stop, paper trading   │   (JSON)    │  → circuit breaker           │
 │ fires alert() on signals  │             │  → risk sizing (contracts)   │
 └──────────────────────────┘             │  → Tradovate API order        │
                                           │ + logging, reports, alerts    │
                                           └──────────────────────────────┘
```

> ⚠️ **Read [“The small-account reality”](#the-small-account-reality) first.**
> Index/gold futures and a *small* account with a strict 1%-risk rule are
> mathematically in tension. This section is the most important thing here.

---

## Why this shape (and what changed from “stocks on Alpaca”)

You asked for TradingView + Tradovate. **Tradovate trades futures only** — no
stocks or ETFs — so the original stock-specific plan was retargeted:

| Original (stocks/Alpaca) | Now (futures/Tradovate) |
|---|---|
| 5–8 low-priced ETFs | MNQ + MGC micro futures |
| PDT rule avoidance | **No PDT rule** on futures — dropped |
| Fractional shares | **Whole contracts only**; micros are the “small” unit |
| 5–8% percentage stop | **ATR-based stop** (a % stop is far too wide on futures) |
| Once-daily after close | Pine alerts on **daily/4H bar close**; relay executes |

Everything else you asked for is intact: EMA10/30 crossover + RSI filter,
max 1–2 positions, stop on every trade, daily/weekly loss circuit breaker,
modular data → signal → risk → execution, full logging, halt-and-alert,
daily report, and **backtest-then-paper-first**.

---

## Strategy logic

**Entry (long):** the fast EMA (10) crosses **above** the slow EMA (30) — a
“golden cross” — **and** RSI(14) ≤ 70. The RSI filter blocks entries into an
already-overbought, extended move (no chasing).

**Exit (long):** the fast EMA crosses **below** the slow EMA (“death cross”),
**or** price hits the stop.

**Stop:** `entry − 2 × ATR(14)` by default (configurable: `atr` / `points` /
`percent`). ATR adapts the stop to each instrument’s volatility, which a fixed
percentage cannot.

**Shorts:** supported but **off by default** (`ALLOW_SHORTS=false`). Mirror
logic: death cross + RSI ≥ 30 to short, golden cross to cover. Turn on only
after the long side is validated.

**Swing, not intraday:** `MIN_HOLD_DAYS=1` means a position can never be opened
and closed the same day. Decisions are taken on **bar close** (daily or 4H).

This is a **trend-following** system. Expect its classic signature: a **low win
rate** (many small losses when the trend chops) offset by a **few large winners**
when a real trend runs. Profit factor > 1 comes from win *size*, not win *rate* —
you must be able to sit through losing streaks.

---

## The small-account reality

Sizing ties position size to the stop: **dollars risked = stop distance (points)
× point value × contracts**, capped at `RISK_PER_TRADE_PCT` of equity. That is
correct risk management — but on these instruments it collides with a small
account. Using representative ATRs:

| Instrument | $/point | ~2×ATR stop | **Risk per 1 micro contract** | Account needed to risk **1%** |
|---|---|---|---|---|
| **MNQ** (Micro Nasdaq) | $2 | ~640 pts | **≈ $1,280** | **≈ $128,000** |
| **MGC** (Micro Gold) | $10 | ~63 pts | **≈ $632** | **≈ $63,000** |

So on a $3–6k account you **cannot** both trade 1 contract *and* keep per-trade
risk near 1%. Your real choices:

1. **Fund it properly.** ~$60k+ to swing MGC, ~$130k+ for MNQ, at 1% risk. Then
   the guardrails work as designed.
2. **Accept large per-trade risk.** One MGC micro on a $6k account ≈ **10% risk
   per trade**. The backtester with that setting shows a **−44% drawdown** — a
   near account-killer. This is not a safe way to run a small account.
3. **Tighten the stop / drop to a lower timeframe.** Reduces $-risk per contract
   but increases whipsaw and drifts toward day-trading (away from “swing”).
4. **Trade MGC (gold) over MNQ** while small — its per-contract risk is roughly
   half.

The bot does the safe thing by default: with `RISK_PER_TRADE_PCT=0.01` on a
small account it **places zero trades** rather than over-risk. That is the sizer
working, not a bug. Decide deliberately before loosening it.

---

## Backtest results (illustrative)

Run against the built-in **synthetic** data (deterministic geometric random
walk) so it works with no keys/network. **These numbers demonstrate the
mechanics and risk profile — they are NOT predictive.** For real research use
`--source yfinance` (NQ=F/GC=F proxies) or `--source csv` with your own exports.

**Scenario A — properly capitalized ($130k, 1% risk, MNQ+MGC):**

```
Total return  : +6.21%      Max drawdown : -9.97%
CAGR          :  3.08%      Sharpe       :  0.51
Trades        : 18          Win rate     : 33.3%   (trend-following signature)
Profit factor : 1.52        Avg win/loss : $3,215 / -$1,055
```

**Scenario B — small account ($6k, MGC only, ~10% risk/trade):**

```
Total return  : -11.12%     Max drawdown : -44.62%   ← the small-account danger
Trades        : 5           Win rate     : 20.0%
Profit factor : 0.79
```

Reproduce:

```bash
# Scenario A
WATCHLIST=MNQ,MGC RISK_PER_TRADE_PCT=0.01 MAX_CONTRACTS_PER_SYMBOL=3 \
  python3 run_backtest.py --source synthetic --equity 130000

# Scenario B
WATCHLIST=MGC RISK_PER_TRADE_PCT=0.12 MAX_CONTRACTS_PER_SYMBOL=1 \
  python3 run_backtest.py --source synthetic --equity 6000
```

Outputs land in `logs/backtest/` (`equity_curve.csv`, `trades.csv`, and a PNG if
matplotlib is installed).

---

## Layout

```
tv_tradovate_bot/
├── pine/swing_strategy.pine     # LIVE brain: add to a TradingView chart
├── swingbot/
│   ├── config.py                # all parameters + secrets from env/.env
│   ├── contracts.py             # MNQ/MGC economics (point value, tick, margin)
│   ├── indicators.py            # EMA / RSI / ATR (match Pine's ta.*)
│   ├── strategy.py              # signal generation (research mirror of Pine)
│   ├── risk.py                  # sizing, ATR stop, hold guard, circuit breakers
│   ├── backtest.py              # event-driven futures backtester
│   ├── data.py                  # research data: synthetic / yfinance / csv
│   ├── tradovate.py             # Tradovate REST client (the only broker code)
│   ├── engine.py                # alert → risk → order decision logic
│   ├── relay/server.py          # FastAPI webhook receiver (thin wrapper)
│   ├── state.py                 # positions/equity marks/halt flag (JSON)
│   ├── report.py, notify.py, logging_setup.py, synthetic.py
├── run_backtest.py  run_relay.py  run_report.py
├── tests/                       # pytest: indicators, risk, engine, backtest
├── requirements.txt   .env.example
```

Modules are separated exactly as requested: **data → signal → risk →
execution**, each independently testable (`risk.py` and `engine.py` never touch
the network).

---

## Setup

```bash
cd tv_tradovate_bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then edit .env
pytest -q                     # 16 tests should pass
```

---

## The paper-first path (do these in order)

1. **Backtest research.** `python3 run_backtest.py --source yfinance` (on a
   machine with Yahoo access). Tune EMA/RSI/ATR and confirm you understand the
   drawdowns. Read the numbers.
2. **TradingView paper.** Add `pine/swing_strategy.pine` to an `MNQ1!` or
   `MGC1!` daily chart. Use the Strategy Tester and TradingView **paper trading**
   to watch it operate with no money at risk.
3. **Relay in dry-run.** `RELAY_DRY_RUN=true python3 run_relay.py`. Point a
   TradingView alert at it and confirm every decision is computed and logged but
   **no order is placed**. This validates the wiring end-to-end.
4. **Tradovate DEMO.** Set `RELAY_DRY_RUN=false`, `TRADOVATE_ENV=demo`, and real
   Tradovate API credentials. Run for **4–6 weeks**. Compare the daily reports to
   TradingView’s own paper results — they should track closely.
5. **Live — deliberate switch only.** Only after a clean demo run: set
   `TRADOVATE_ENV=live`. Start with the smallest size and the account-size math
   above firmly in mind.

---

## Wiring TradingView → relay → Tradovate

**1. Host the relay** somewhere with a public HTTPS URL (a small VPS, or a tunnel
like Cloudflare Tunnel / ngrok in front of `run_relay.py`). TradingView must be
able to POST to `https://your-host/webhook`.

**2. Set a strong `WEBHOOK_SECRET`** in `.env` and put the same string in the
Pine strategy’s “Webhook shared secret” input. The relay rejects any alert
without an exact match (the endpoint is public).

**3. Create the alert** on the strategy: condition **“Any alert() function
call”**, message left to the built-in `alert_message` (the Pine builds the JSON),
webhook URL = your `/webhook`. Set the strategy’s **“Symbol tag”** input to `MNQ`
or `MGC` so the relay knows which contract.

**4. Tradovate API access.** You need API credentials (app id / cid / secret)
from your Tradovate account, plus your username/password. Practice on the
**demo** endpoint first. Verify the payload field names in
`swingbot/tradovate.py` against the current Tradovate API docs for your account
before going live — brokers occasionally change them; every call is logged so
mismatches surface immediately.

Alert JSON contract (built by the Pine, validated by the relay):

```json
{ "secret":"…", "id":"MNQ-1D-169…", "action":"long_entry",
  "symbol":"MNQ", "price":21743.0, "atr":320.1, "rsi":58.4 }
```

`action` ∈ `long_entry | long_exit | short_entry | short_exit | flat`.

---

## Risk management (all enforced server-side in the relay)

- **Max 1–2 positions** (`MAX_OPEN_POSITIONS`) and per-symbol contract cap.
- **ATR stop on every position** — placed as a **resting GTC stop order at
  Tradovate** on entry (broker-enforced gap protection), cancelled automatically
  when the position is closed for another reason, and re-checked at each alert as
  a backstop.
- **Whole-contract sizing** floored by `RISK_PER_TRADE_PCT` and a margin cap.
- **Min-hold / swing guard** — no same-day round trips.
- **Daily & weekly loss circuit breakers** — a trip **halts new entries** and
  alerts; protective exits still run (configurable). The halt persists in state
  until equity marks roll to a new day/week.
- **Idempotency** — each alert `id` is processed once (TradingView can resend).
- **Halt-and-alert on any error** — the engine never fails silently; it flips the
  halt flag and (if email is configured) notifies.

---

## Ops

- **Scheduling** is TradingView’s job: alerts fire on bar close. No cron needed
  for trading. For the **daily report**, schedule `run_report.py` once after the
  futures settlement (e.g. cron `30 21 * * 1-5`).
- **Logging**: rotating file at `logs/swingbot.log` + console. Every decision and
  order is recorded.
- **Reports**: `logs/reports/report_*.txt`, optionally emailed.
- **State**: `data/state.json` (human-readable; hand-editable in emergencies).

---

## Limitations & honest disclaimers

- **Not financial advice.** A mechanical EMA/RSI crossover is a *starting
  template*, not an edge. Trend systems endure long, painful drawdowns.
- **Stops: broker-enforced, with a caveat.** On each entry the relay submits a
  **resting GTC stop order** to Tradovate (`USE_BROKER_STOP=true`), so the broker
  enforces the stop even if no further alert arrives — this is the primary gap
  protection. The relay's alert-time stop check and the Pine native stop are
  backstops. Caveat: a stop order fills at the market *after* the stop is
  touched, so a violent gap can still fill worse than the stop price — futures
  are leveraged and this residual gap risk cannot be fully removed.
- **Backtest ≠ live.** Synthetic results are illustrative; real fills, slippage,
  overnight gaps, and margin calls will differ. yfinance proxies (NQ=F/GC=F) are
  the index/gold underlying, not the exact micro contract.
- **Verify Tradovate payloads** against current docs before live trading.
- **Leverage cuts both ways.** Futures are leveraged; losses can exceed the
  per-trade budget on a gap. Size accordingly.

Run `pytest -q` after any change.
