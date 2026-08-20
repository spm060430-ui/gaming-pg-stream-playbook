// AI Station — configuration.
//
// This is the single place where every risk limit lives. The prompt pack in
// docs/ai-station-agent-prompts.md leaves these as [brackets]; here they are
// filled with conservative defaults. THESE NUMBERS ARE THE REAL GUARDRAILS:
// riskEngine.js enforces them in code, so an agent physically cannot exceed
// them no matter what its language model proposes. Editing a prompt cannot
// loosen them — only editing this file can. Tune to your own risk tolerance
// before this ever touches real money (and read the README first).
//
// All monetary values are in the account's base currency (assumed USD).
// All percentages are expressed as fractions (0.10 === 10%).

export const config = {
  // ---- Mode -------------------------------------------------------------
  // "paper"  — simulated fills against simulated feeds. No real money. (default)
  // "live"   — intentionally unimplemented. The live execution adapters throw
  //            on purpose so nobody flips this on by accident. Wiring a real
  //            broker or sportsbook is a deliberate act you take on yourself.
  mode: "paper",

  // ---- Model ------------------------------------------------------------
  // The Claude model each agent uses to make decisions. Override with the
  // AI_STATION_MODEL env var. Any current model id works; a cheaper/faster
  // model is a reasonable choice for high-frequency decisions.
  model: process.env.AI_STATION_MODEL || "claude-opus-5",

  // ---- Master ledger (Station Commander) --------------------------------
  bankroll: 10_000, // total capital under management

  // How the Commander reserves capital between the two desks. Reserved, not
  // shared — the two agents can never draw on the same dollar simultaneously.
  allocations: {
    trading: 0.40, // 40% -> Futures Desk
    betting: 0.20, // 20% -> Book Desk
    // remaining 40% stays in reserve
  },

  // Portfolio-level limits enforced by the Commander.
  portfolio: {
    maxCombinedExposure: 0.50, // never more than 50% of bankroll at risk at once
    killSwitch: {
      rolling24hLoss: 0.06, // freeze BOTH desks if 24h losses exceed 6% of bankroll
      rolling7dLoss: 0.12, // freeze BOTH desks if 7d losses exceed 12% of bankroll
    },
  },

  // ---- Futures Desk (trading agent) -------------------------------------
  trading: {
    // Which concrete instruments this desk is allowed to touch. Everything
    // else is rejected by the risk engine, prompt or no prompt.
    instruments: {
      GOLD: { symbol: "GLD", kind: "etf-proxy", label: "Gold (GLD proxy)" },
      SP500: { symbol: "SPY", kind: "etf-proxy", label: "S&P 500 (SPY proxy)" },
      NASDAQ: { symbol: "QQQ", kind: "etf-proxy", label: "NASDAQ (QQQ proxy)" },
    },
    maxPositionPerInstrument: 0.25, // 25% of allocated capital per instrument
    maxLeverage: 2, // 2x. Never increased to recover a loss (enforced in code).
    maxConcurrentPositions: 3, // across all three instruments
    requireStopLoss: true, // no position opens without a stop
    maxStopDistance: 0.05, // a stop may be at most 5% away from entry
    dailyLossLimit: 0.03, // stop trading for the day at 3% of allocated capital
    weeklyLossLimit: 0.07, // stop trading for the week at 7% of allocated capital
    allowAveragingDown: false, // never add to a losing position
    // Minutes after open / before close during which no new positions open.
    session: { openBufferMin: 5, closeBufferMin: 5 },
  },

  // ---- Book Desk (sports betting agent) ---------------------------------
  betting: {
    // Leagues this desk may bet. Anything else is rejected in code.
    leagues: ["NFL", "NBA", "MLB"],
    // Bet types allowed. Parlays/props are intentionally excluded by default
    // because of their worse odds — add them only with a tested edge.
    betTypes: ["moneyline", "spread", "total"],
    minEdge: 0.03, // only bet at +3% expected value or better (vig included)
    stakeSizing: "fractional-kelly", // "flat" | "fractional-kelly"
    kellyFraction: 0.25, // quarter-Kelly. Never full Kelly (too volatile).
    flatStake: 0.01, // used when stakeSizing === "flat": 1% of bankroll
    maxStakePerBet: 0.02, // hard cap: 2% of allocated bankroll on any one bet
    dailyLossLimit: 0.05, // stop betting for the day at 5% of allocated bankroll
    weeklyLossLimit: 0.10, // stop betting for the week at 10% of allocated bankroll
    // Rolling window used to flag a persistently negative model.
    reviewSample: 100, // bets
  },

  // ---- Runtime ----------------------------------------------------------
  // How many decision cycles a `run` executes and how long a simulated
  // "day" is, in ticks (used only to trigger end-of-day reports in the sim).
  runtime: {
    defaultTicks: 12,
    ticksPerDay: 6,
  },
};

export default config;
