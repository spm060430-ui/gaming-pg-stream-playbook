# AI Station — three-agent paper-trading orchestrator

A runnable implementation of the [AI Station prompt pack](../docs/ai-station-agent-prompts.md):
a **Station Commander** that supervises a **Futures Desk** (gold / S&P 500 /
NASDAQ proxies) and a **Book Desk** (sports betting). Each agent makes its
decisions with Claude; a deterministic risk engine enforces every hard limit.

> ⚠️ **Paper mode only.** This runs entirely against *simulated* market and odds
> feeds with *fake* money. There is no broker or sportsbook integration, and the
> live-execution path is intentionally left unimplemented so it can't be flipped
> on by accident. Read [Before you go live](#before-you-go-live) before you even
> think about changing that.

## The one idea that matters

**The LLM proposes; deterministic code disposes.**

Every action an agent's language model wants to take — open a position, place a
bet — is a *proposal*. Before it can touch the ledger it passes through
[`src/riskEngine.js`](src/riskEngine.js), which checks it against the limits in
[`config.js`](config.js) and rejects anything that breaches them. The limits
live in code, not in a prompt, so:

- No amount of clever prompting (or prompt injection) can loosen them.
- "The risk controls cannot be self-overridden" is *literally true* — the model
  never gets to write to the ledger directly.
- Editing a system prompt can't raise a cap. Only editing `config.js` can.

That is the whole reason autonomous execution is tolerable here. The
[test suite](test/riskEngine.test.js) exists to prove the guardrails fire.

## Run it

No install needed for a dry run (it uses deterministic stub decisions instead
of calling Claude):

```bash
cd agents
node src/index.js run --dry --ticks 8
```

For real Claude-driven decisions, install the SDK and provide a key:

```bash
npm install
cp .env.example .env      # then put your ANTHROPIC_API_KEY in it
npm start                 # node src/index.js run
```

Run the guardrail tests (no key, no install required):

```bash
npm test                  # node test/riskEngine.test.js
```

### CLI

```
node src/index.js run [--ticks N] [--dry] [--report-only] [--model ID]
```

| Flag | Meaning |
|------|---------|
| `--dry` | Never call the API; use deterministic stubs. Auto-enabled when no `ANTHROPIC_API_KEY` is set. |
| `--ticks N` | Number of decision cycles. One cycle == one simulated hour. |
| `--report-only` | Suppress per-tick lines; print only day/final summaries. |
| `--model ID` | Override the **Commander** (oversight) model. Default `claude-opus-5` / `AI_STATION_MODEL`. |
| `--worker-model ID` | Override the **desks'** (high-frequency) model. Default `claude-haiku-4-5` / `AI_STATION_WORKER_MODEL`. |
| `--out FILE` | Where to write the JSON run log. Default `runs/run-<timestamp>.json`. |
| `--no-log` | Don't write a run log. |

### Two models, two roles

The Commander runs once per cycle and its judgment gates real money, so it gets
the stronger model (`claude-opus-5`). The two desks make the high-frequency,
in-the-weeds calls, so they default to a cheaper, faster model
(`claude-haiku-4-5`). Tune both in [`config.js`](config.js) under `models`, via
env vars, or with the flags above.

### Run logs

Every run (unless `--no-log`) writes a structured JSON record to `runs/` (which
is git-ignored): metadata, the exact risk limits in force, the final ledger,
per-desk reports, and every logged event including guardrail rejections. Useful
for after-the-fact analysis and audits.

## How a cycle works

Each tick, the **Commander**:

1. Advances the simulated clock and ticks the market feed.
2. Runs the **kill switch** (deterministic): if rolling 24h or 7d portfolio
   losses breach the limits in `config.js`, it freezes *both* desks and escalates.
   It does **not** auto-resume — resuming a frozen desk is a human decision.
3. Sets a per-desk **posture** (clear / hold). This is the one place the
   Commander consults Claude, and it can only *add* caution — turn a "clear"
   into a "hold" — never authorize something the risk engine forbids.

Then each cleared desk runs:

- **Futures Desk** — marks open positions to market (auto-closing any that hit
  their stop or target), then asks Claude for one action: open (always with a
  protective stop), close, or hold. The risk engine validates position size,
  leverage, concurrent-position count, stop placement, no-averaging-down, and
  daily/weekly loss limits before anything opens.
- **Book Desk** — pulls a slate of candidate games (each with book odds and an
  implied probability), asks Claude to estimate its own win probability and pick
  the single best positive-edge bet or pass. The risk engine enforces the
  minimum edge, the single-bet stake cap, fractional-Kelly sizing, an
  anti-chasing rule, and daily/weekly loss limits.

At the end of each simulated day and at the end of the run, the Commander prints
a numbers-first summary with anomalies (freezes, rejections) surfaced at the top.

## Layout

| File | Purpose |
|------|---------|
| `config.js` | **Every risk limit, in one place.** The `[brackets]` from the prompt pack, filled with conservative defaults. |
| `src/riskEngine.js` | Deterministic guardrails. Validates every proposed action. The real safety layer. |
| `src/ledger.js` | Master ledger: bankroll, reserved allocations, realized P&L, rolling-window history. |
| `src/commander.js` | Station Commander: clock, kill switch, posture gate, reporting. |
| `src/agents/tradingAgent.js` | Futures Desk. |
| `src/agents/bettingAgent.js` | Book Desk. |
| `src/llm.js` | Anthropic SDK wrapper — one forced-tool-use decision per call. |
| `src/prompts.js` | The three system prompts, adapted from the prompt pack. |
| `src/feeds/marketFeed.js` | Simulated GC/ES/NQ-proxy price feed (random walk + mean reversion). |
| `src/feeds/oddsFeed.js` | Simulated sports odds feed with a hidden true probability. |
| `src/reporter.js` | End-of-day / final summary formatting. |
| `src/logger.js` | Compact structured logging; every rejection printed loudly. |
| `test/riskEngine.test.js` | Proves the guardrails reject out-of-limit actions. |

## Tuning

Open [`config.js`](config.js) and change the numbers. They are documented inline.
Start conservative. The defaults reserve 40% of bankroll to trading, 20% to
betting, keep 40% in reserve, cap combined exposure at 50%, and trip the
portfolio kill switch at a 6% rolling-24h / 12% rolling-7d loss.

## Before you go live

`config.mode` is `"paper"` and the runner refuses to start in any other mode —
the live-execution adapters are deliberately absent. If you ever build them:

- **Simulate for weeks first.** The whole point of paper mode is to find the bug
  in your stop-loss logic with fake money, not real money.
- **You still need a real edge.** This repo supplies *structure and guardrails*,
  not a profitable strategy. The market and odds feeds here are random walks —
  the agents can't and don't have predictive power over them. Plugging in a real
  broker without a validated edge just loses money inside the guardrails.
- **Check the terms of service.** Most retail brokers permit API algo-trading.
  **Most sportsbooks explicitly prohibit automated betting** and will limit or
  close accounts that use it — so the Book Desk, wired to a real book, is likely
  to get your account banned regardless of how good its model is. Confirm before
  you build, not after.
- **This is not financial or betting advice.**
