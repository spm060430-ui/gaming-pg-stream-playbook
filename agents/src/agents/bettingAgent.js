// Book Desk — places sports bets in paper mode.
//
// Flow each cycle:
//   1. Fetch a slate of candidate games from the odds feed.
//   2. Ask the decision layer (Claude, or the dry stub) for ONE action:
//      place a bet on the best positive-edge candidate, or pass.
//   3. Validate through the risk engine (edge threshold, stake caps, anti-
//      chasing, loss limits). Reject -> log, do nothing.
//   4. Accept -> place the bet, settle it against the hidden true probability,
//      and record the result on the ledger. Track CLV and recent stakes.

import { round } from "../ledger.js";

const TOOLS = [
  {
    name: "place_bet",
    description: "Place a bet on the single best positive-edge candidate.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidateId: { type: "string", description: "id from the slate." },
        modelProb: { type: "number", description: "Your estimated win probability, 0-1." },
        stake: { type: "number", description: "Stake in dollars (engine caps it)." },
        edgeNote: { type: "string", description: "One line on the estimated edge." },
      },
      required: ["candidateId", "modelProb", "stake", "edgeNote"],
    },
  },
  {
    name: "pass",
    description: "Place no bet this cycle.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

export class BettingAgent {
  constructor({ config, ledger, risk, decider, feed, logger, system }) {
    this.config = config;
    this.ledger = ledger;
    this.risk = risk;
    this.decider = decider;
    this.feed = feed;
    this.logger = logger;
    this.system = system;
    this.slate = [];
    this.recentStakes = []; // last few stakes, for the anti-chasing rule
    this.clvSamples = []; // beat-the-close proxy per settled bet
    this.settledCount = 0;
  }

  buildContext() {
    return {
      allocatedBankroll: this.ledger.reserved.betting,
      realizedPnl: this.ledger.realized.betting,
      minEdge: this.config.betting.minEdge,
      maxStakePerBet: round(this.config.betting.maxStakePerBet * this.ledger.reserved.betting),
      candidates: this.slate.map((c) => ({
        id: c.id,
        league: c.league,
        betType: c.betType,
        selection: c.selection,
        matchup: c.matchup,
        odds: c.odds,
        impliedProb: c.impliedProb,
      })),
    };
  }

  // Deterministic offline decision for --dry runs. Nudges an estimate above the
  // book's implied probability on the first candidate to exercise the accept
  // path; the risk engine still decides whether it clears.
  stub(context) {
    const c = context.candidates[0];
    if (!c) return { tool: "pass", input: { reason: "empty slate" } };
    const modelProb = Math.min(0.97, c.impliedProb + 0.05);
    const stake = this.risk.suggestedStake(c.odds, modelProb);
    if (stake <= 0) return { tool: "pass", input: { reason: "no positive-kelly stake" } };
    return {
      tool: "place_bet",
      input: { candidateId: c.id, modelProb: round4(modelProb), stake, edgeNote: "dry-stub +5%" },
    };
  }

  async run() {
    this.slate = this.feed.slate(3);

    if (this.ledger.frozen.betting) {
      this.logger.event("betting", "skip", { reason: "frozen by Commander" });
      return;
    }

    const context = this.buildContext();
    const decision = await this.decider.decide({
      system: this.system,
      context,
      tools: TOOLS,
      stub: (c) => this.stub(c),
    });

    if (!decision.ok) {
      this.logger.event("betting", "error", { error: decision.error });
      return;
    }

    const { toolName, action } = decision;

    if (toolName === "pass") {
      this.logger.event("betting", "pass", { reason: action.reason });
      return;
    }

    if (toolName === "place_bet") {
      const cand = this.slate.find((c) => c.id === action.candidateId);
      if (!cand) {
        this.logger.event("betting", "error", { error: `unknown candidate ${action.candidateId}` });
        return;
      }
      // Assemble the full action the risk engine expects from the candidate +
      // the model's estimate. The agent cannot forge league/odds — they come
      // from the slate.
      const full = {
        league: cand.league,
        betType: cand.betType,
        selection: cand.selection,
        odds: cand.odds,
        modelProb: action.modelProb,
        stake: action.stake,
      };
      const check = this.risk.validateBet(full, { recentStakes: this.recentStakes });
      if (!check.ok) {
        this.logger.reject("betting", full, check);
        return;
      }

      // Place + settle immediately in the sim.
      const bet = { ...cand, stake: round(action.stake) };
      const pnl = this.feed.settle(bet);
      this.ledger.recordPnl("betting", pnl);
      this.recentStakes = [...this.recentStakes, bet.stake].slice(-10);
      this.settledCount++;
      // CLV proxy: did our estimate beat the book's implied number?
      this.clvSamples.push(action.modelProb - cand.impliedProb);

      this.logger.event("betting", "bet", {
        id: cand.id,
        league: cand.league,
        betType: cand.betType,
        selection: cand.selection,
        odds: cand.odds,
        stake: bet.stake,
        modelProb: action.modelProb,
        edge: round4(action.modelProb - cand.impliedProb),
        result: pnl >= 0 ? "win" : "loss",
        pnl: round(pnl),
        note: action.edgeNote,
      });

      // Bets settle same-cycle, so no lingering exposure.
      this.ledger.setExposure("betting", 0);
      return;
    }

    this.logger.event("betting", "error", { error: `unknown tool ${toolName}` });
  }

  report() {
    const avgClv = this.clvSamples.length
      ? round4(this.clvSamples.reduce((a, b) => a + b, 0) / this.clvSamples.length)
      : 0;
    return {
      settled: this.settledCount,
      realizedPnl: round(this.ledger.realized.betting),
      avgClvEdge: avgClv,
    };
  }
}

const round4 = (n) => Math.round(n * 10000) / 10000;
