#!/usr/bin/env node
// AI Station — CLI entry point.
//
// Usage:
//   node src/index.js run [--ticks N] [--dry] [--report-only] [--model ID]
//
//   --dry            Never call the API; use deterministic stubs. Auto-enabled
//                    when no ANTHROPIC_API_KEY is set.
//   --ticks N        Number of decision cycles (one cycle == one sim-hour).
//   --report-only    Suppress per-tick lines; print only day/final summaries.
//   --model ID       Override the Commander (oversight) model.
//   --worker-model   Override the desks' (high-frequency) model.
//   --out FILE       Write a JSON run log here (default runs/run-<ts>.json).
//   --no-log         Don't write a run log.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { loadEnv } from "./env.js";
import { Ledger } from "./ledger.js";
import { RiskEngine } from "./riskEngine.js";
import { Logger } from "./logger.js";
import { Decider } from "./llm.js";
import { MarketFeed } from "./feeds/marketFeed.js";
import { OddsFeed } from "./feeds/oddsFeed.js";
import { TradingAgent } from "./agents/tradingAgent.js";
import { BettingAgent } from "./agents/bettingAgent.js";
import { Commander } from "./commander.js";
import { COMMANDER_SYSTEM, TRADING_SYSTEM, BETTING_SYSTEM } from "./prompts.js";
import { summary } from "./reporter.js";

loadEnv();

function parseArgs(argv) {
  const args = { command: argv[2] || "run", ticks: config.runtime.defaultTicks, dry: false, reportOnly: false, log: true };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") args.dry = true;
    else if (a === "--report-only") args.reportOnly = true;
    else if (a === "--no-log") args.log = false;
    else if (a === "--ticks") args.ticks = parseInt(argv[++i], 10);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--worker-model") args.workerModel = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command !== "run") {
    console.error(`Unknown command "${args.command}". Try: node src/index.js run --dry`);
    process.exit(1);
  }

  const commanderModel = args.model || config.models.commander;
  const workerModel = args.workerModel || config.models.worker;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const dry = args.dry || !hasKey;

  if (config.mode !== "paper") {
    console.error(`Refusing to run: config.mode is "${config.mode}". Live execution is not implemented.`);
    process.exit(1);
  }

  console.log("AI Station — PAPER MODE (no real money)");
  console.log(
    `mode=${dry ? "dry (stub decisions)" : "live-LLM"}  ` +
      `ticks=${args.ticks}  bankroll=${config.bankroll}`,
  );
  if (!dry) console.log(`models: commander=${commanderModel}  desks=${workerModel}`);
  if (dry && !args.dry) console.log("(no ANTHROPIC_API_KEY found — using deterministic stubs; set the key for real LLM decisions)");
  console.log("");

  const ledger = new Ledger(config);
  const risk = new RiskEngine(config, ledger);
  const logger = new Logger({ quiet: args.reportOnly });
  // Two deciders: the Commander gets the stronger model, the desks the cheaper
  // one. In dry mode neither calls the API.
  const commanderDecider = new Decider({ model: commanderModel, dry });
  const workerDecider = new Decider({ model: workerModel, dry });
  const marketFeed = new MarketFeed(config.trading.instruments);
  const oddsFeed = new OddsFeed(config.betting.leagues, config.betting.betTypes);

  const trading = new TradingAgent({ config, ledger, risk, decider: workerDecider, feed: marketFeed, logger, system: TRADING_SYSTEM });
  const betting = new BettingAgent({ config, ledger, risk, decider: workerDecider, feed: oddsFeed, logger, system: BETTING_SYSTEM });

  const commander = new Commander({
    config,
    ledger,
    decider: commanderDecider,
    feed: marketFeed,
    logger,
    system: COMMANDER_SYSTEM,
    agents: { trading, betting },
  });

  const ticksPerDay = config.runtime.ticksPerDay;
  let done = 0;
  let day = 1;
  while (done < args.ticks) {
    const chunk = Math.min(ticksPerDay, args.ticks - done);
    await commander.runDay(done, chunk, day);
    done += chunk;
    day++;
  }

  console.log(
    summary("FINAL SUMMARY", {
      ledger,
      trading: trading.report(),
      betting: betting.report(),
      logger,
    }),
  );

  if (args.log) {
    const path = writeRunLog(args, {
      dry,
      commanderModel,
      workerModel,
      ledger,
      trading: trading.report(),
      betting: betting.report(),
      logger,
    });
    console.log(`Run log: ${path}`);
  }
}

// Persist the whole run as structured JSON: metadata, the risk limits that were
// in force, the final ledger, per-desk reports, and every logged event
// (including rejections). Useful for after-the-fact analysis and audits.
function writeRunLog(args, { dry, commanderModel, workerModel, ledger, trading, betting, logger }) {
  const startedAt = new Date();
  const out =
    args.out ||
    `runs/run-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`;
  const record = {
    meta: {
      startedAt: startedAt.toISOString(),
      mode: config.mode,
      decisions: dry ? "dry-stub" : "live-llm",
      models: dry ? null : { commander: commanderModel, worker: workerModel },
      ticks: args.ticks,
    },
    limits: {
      bankroll: config.bankroll,
      allocations: config.allocations,
      portfolio: config.portfolio,
      trading: config.trading,
      betting: config.betting,
    },
    finalLedger: ledger.snapshot(),
    reports: { trading, betting },
    events: logger.events,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(record, null, 2));
  return out;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
