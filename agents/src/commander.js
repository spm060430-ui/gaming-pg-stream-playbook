// Station Commander — the orchestrator.
//
// It owns the single Ledger and the RiskEngine, advances the simulated clock,
// runs the portfolio kill switch, and gates each desk per cycle. Its authority
// is asymmetric by design: it can HOLD or FREEZE a desk, but it can never
// authorize an action the risk engine forbids. Hard safety (kill switch,
// exposure cap) is deterministic code; the LLM gate only ever ADDS caution.

import { RiskEngine } from "./riskEngine.js";
import { summary } from "./reporter.js";

const POSTURE_TOOL = [
  {
    name: "set_posture",
    description: "Set this cycle's posture for each desk: clear (may act) or hold (stand down).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        trading: { type: "string", enum: ["clear", "hold"] },
        betting: { type: "string", enum: ["clear", "hold"] },
        note: { type: "string" },
      },
      required: ["trading", "betting", "note"],
    },
  },
];

const HOUR_MS = 60 * 60 * 1000;

export class Commander {
  constructor({ config, ledger, decider, feed, logger, system, agents }) {
    this.config = config;
    this.ledger = ledger;
    this.decider = decider;
    this.feed = feed;
    this.logger = logger;
    this.system = system;
    this.agents = agents; // { trading, betting }
    this.risk = new RiskEngine(config, ledger);
    this.halted = false; // set once a kill switch trips
  }

  // Deterministic hard-safety pass. Trips the kill switch and freezes both
  // desks; does NOT auto-resume (resuming needs a human, per the prompt pack).
  enforceSafety() {
    const verdict = this.risk.checkKillSwitch();
    if (!verdict.ok && !this.halted) {
      this.halted = true;
      this.ledger.frozen.trading = true;
      this.ledger.frozen.betting = true;
      this.logger.event("commander", "FREEZE", { code: verdict.code, reason: verdict.reason });
      this.logger.event("commander", "ESCALATE", {
        code: verdict.code,
        reason: "Kill switch tripped — both desks frozen. Human confirmation required to resume.",
      });
    }
  }

  // Discretionary gate. Returns { trading: bool, betting: bool } — whether each
  // desk may act this cycle. Frozen desks are always false. The LLM (or dry
  // stub) can only turn a "clear" into a "hold", never the reverse.
  async posture() {
    if (this.halted) return { trading: false, betting: false };

    const context = {
      ledger: this.ledger.snapshot(),
      rolling24hPnl: this.risk.ledger.rollingPnl(24 * HOUR_MS),
      rolling7dPnl: this.risk.ledger.rollingPnl(7 * 24 * HOUR_MS),
      killSwitch: this.risk.checkKillSwitch(),
      exposureCap: this.config.portfolio.maxCombinedExposure * this.config.bankroll,
    };

    const decision = await this.decider.decide({
      system: this.system,
      context,
      tools: POSTURE_TOOL,
      stub: () => ({ tool: "set_posture", input: { trading: "clear", betting: "clear", note: "dry: nominal" } }),
    });

    // On any failure, be conservative: hold both.
    if (!decision.ok || decision.toolName !== "set_posture") {
      this.logger.event("commander", "hold-all", { reason: decision.error || "no posture returned" });
      return { trading: false, betting: false };
    }

    const p = decision.action;
    this.logger.event("commander", "posture", { trading: p.trading, betting: p.betting, note: p.note });
    return {
      trading: !this.ledger.frozen.trading && p.trading === "clear",
      betting: !this.ledger.frozen.betting && p.betting === "clear",
    };
  }

  async tick(t) {
    this.logger.setTick(t);
    this.ledger.now = t * HOUR_MS; // one tick == one sim-hour
    this.feed.tick();

    // Hard safety first, every cycle.
    this.enforceSafety();

    // Then the discretionary posture gate.
    const allow = await this.posture();

    // Desks that lose their allocation to a mark-to-market stop still need to
    // run their close logic, so trading always runs its mark step; new-risk
    // actions are what the gate governs (handled inside each agent via frozen).
    if (allow.trading) await this.agents.trading.run();
    else {
      this.agents.trading.markToMarket(); // still honor stops even while held
      this.logger.event("trading", "held", { by: "commander" });
    }

    if (allow.betting) await this.agents.betting.run();
    else this.logger.event("betting", "held", { by: "commander" });
  }

  async runDay(startTick, ticks, dayIndex) {
    for (let i = 0; i < ticks; i++) await this.tick(startTick + i);
    console.log(
      summary(`END OF DAY ${dayIndex}`, {
        ledger: this.ledger,
        trading: this.agents.trading.report(),
        betting: this.agents.betting.report(),
        logger: this.logger,
      }),
    );
  }
}
