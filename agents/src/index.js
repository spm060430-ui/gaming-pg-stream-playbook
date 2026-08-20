#!/usr/bin/env node
// AI Station — CLI entry point.
//
// Usage:
//   node src/index.js run [--ticks N] [--dry] [--report-only] [--model ID]
//
//   --dry          Never call the API; use deterministic stubs. Auto-enabled
//                  when no ANTHROPIC_API_KEY is set.
//   --ticks N      Number of decision cycles (one cycle == one sim-hour).
//   --report-only  Suppress per-tick lines; print only day/final summaries.
//   --model ID     Override the Claude model (default from config / env).

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
  const args = { command: argv[2] || "run", ticks: config.runtime.defaultTicks, dry: false, reportOnly: false };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") args.dry = true;
    else if (a === "--report-only") args.reportOnly = true;
    else if (a === "--ticks") args.ticks = parseInt(argv[++i], 10);
    else if (a === "--model") args.model = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command !== "run") {
    console.error(`Unknown command "${args.command}". Try: node src/index.js run --dry`);
    process.exit(1);
  }

  const model = args.model || config.model;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const dry = args.dry || !hasKey;

  if (config.mode !== "paper") {
    console.error(`Refusing to run: config.mode is "${config.mode}". Live execution is not implemented.`);
    process.exit(1);
  }

  console.log("AI Station — PAPER MODE (no real money)");
  console.log(
    `mode=${dry ? "dry (stub decisions)" : `live-LLM (${model})`}  ` +
      `ticks=${args.ticks}  bankroll=${config.bankroll}`,
  );
  if (dry && !args.dry) console.log("(no ANTHROPIC_API_KEY found — using deterministic stubs; set the key for real LLM decisions)");
  console.log("");

  const ledger = new Ledger(config);
  const risk = new RiskEngine(config, ledger);
  const logger = new Logger({ quiet: args.reportOnly });
  const decider = new Decider({ model, dry });
  const marketFeed = new MarketFeed(config.trading.instruments);
  const oddsFeed = new OddsFeed(config.betting.leagues, config.betting.betTypes);

  const trading = new TradingAgent({ config, ledger, risk, decider, feed: marketFeed, logger, system: TRADING_SYSTEM });
  const betting = new BettingAgent({ config, ledger, risk, decider, feed: oddsFeed, logger, system: BETTING_SYSTEM });

  const commander = new Commander({
    config,
    ledger,
    decider,
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
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
