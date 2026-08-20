// Futures Desk — trades gold / S&P 500 / NASDAQ proxies in paper mode.
//
// Flow each cycle:
//   1. Mark open positions to market; auto-close any that hit their stop or
//      target and realize the P&L on the ledger.
//   2. Ask the decision layer (Claude, or the dry stub) for ONE action.
//   3. Validate it through the risk engine. Reject -> log, do nothing.
//   4. Accept -> apply it in paper mode and update the ledger.

import { round } from "../ledger.js";

const TOOLS = [
  {
    name: "open_position",
    description: "Open a new position with a mandatory protective stop.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        instrument: { type: "string", enum: ["GOLD", "SP500", "NASDAQ"] },
        direction: { type: "string", enum: ["long", "short"] },
        notional: { type: "number", description: "Dollar size of the position." },
        entry: { type: "number", description: "Intended entry price." },
        stop: { type: "number", description: "Protective stop price (correct side of entry)." },
        target: { type: "number", description: "Optional take-profit price." },
        signal: { type: "string", description: "The specific signal behind this trade." },
      },
      required: ["instrument", "direction", "notional", "entry", "stop", "signal"],
    },
  },
  {
    name: "close_position",
    description: "Close one open position by id.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        positionId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["positionId", "reason"],
    },
  },
  {
    name: "hold",
    description: "Take no new action this cycle.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

export class TradingAgent {
  constructor({ config, ledger, risk, decider, feed, logger, system }) {
    this.config = config;
    this.ledger = ledger;
    this.risk = risk;
    this.decider = decider;
    this.feed = feed;
    this.logger = logger;
    this.system = system;
    this.positions = [];
    this.nextId = 1;
  }

  syncExposure() {
    this.ledger.setExposure("trading", sum(this.positions.map((p) => p.notional)));
  }

  // Step 1: close positions that hit stop/target at current prices.
  markToMarket() {
    const still = [];
    for (const p of this.positions) {
      const price = this.feed.price(p.instrument);
      const hitStop =
        (p.direction === "long" && price <= p.stop) ||
        (p.direction === "short" && price >= p.stop);
      const hitTarget =
        p.target != null &&
        ((p.direction === "long" && price >= p.target) ||
          (p.direction === "short" && price <= p.target));
      if (hitStop || hitTarget) {
        this.closeAt(p, price, hitStop ? "stop" : "target");
      } else {
        still.push(p);
      }
    }
    this.positions = still;
    this.syncExposure();
  }

  closeAt(p, price, why) {
    const pnl = pnlFor(p, price);
    this.ledger.recordPnl("trading", pnl);
    this.logger.event("trading", "close", {
      id: p.id,
      instrument: p.instrument,
      direction: p.direction,
      entry: p.entry,
      exit: round(price),
      notional: p.notional,
      pnl: round(pnl),
      why,
    });
  }

  buildContext() {
    return {
      allocatedCapital: this.ledger.reserved.trading,
      realizedPnl: this.ledger.realized.trading,
      quotes: this.feed.quotes(),
      openPositions: this.positions.map((p) => ({
        id: p.id,
        instrument: p.instrument,
        direction: p.direction,
        notional: p.notional,
        entry: p.entry,
        stop: p.stop,
        target: p.target ?? null,
        markPrice: this.feed.price(p.instrument),
      })),
      limitsReminder: {
        maxNotionalPerInstrument: round(this.config.trading.maxPositionPerInstrument * this.ledger.reserved.trading),
        maxConcurrentPositions: this.config.trading.maxConcurrentPositions,
        maxLeverage: this.config.trading.maxLeverage,
        stopRequired: this.config.trading.requireStopLoss,
      },
    };
  }

  // Deterministic offline decision for --dry runs.
  stub(context) {
    if (this.positions.length >= this.config.trading.maxConcurrentPositions) {
      return { tool: "hold", input: { reason: "at max positions" } };
    }
    // Go long the strongest positive-trend instrument, if any.
    const best = [...context.quotes].sort((a, b) => b.trend - a.trend)[0];
    if (!best || best.trend <= 0) {
      return { tool: "hold", input: { reason: "no positive-trend instrument" } };
    }
    const entry = best.price;
    return {
      tool: "open_position",
      input: {
        instrument: best.instrument,
        direction: "long",
        notional: round(0.5 * this.config.trading.maxPositionPerInstrument * this.ledger.reserved.trading),
        entry,
        stop: round(entry * 0.98), // 2% stop, inside the 5% cap
        target: round(entry * 1.03),
        signal: `dry-stub: trend ${best.trend}`,
      },
    };
  }

  async run() {
    this.markToMarket();

    if (this.ledger.frozen.trading) {
      this.logger.event("trading", "skip", { reason: "frozen by Commander" });
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
      this.logger.event("trading", "error", { error: decision.error });
      return;
    }

    const { toolName, action } = decision;

    if (toolName === "hold") {
      this.logger.event("trading", "hold", { reason: action.reason });
      return;
    }

    if (toolName === "close_position") {
      const check = this.risk.validateTradeClose(action, { positions: this.positions });
      if (!check.ok) {
        this.logger.reject("trading", action, check);
        return;
      }
      const p = this.positions.find((x) => x.id === action.positionId);
      this.positions = this.positions.filter((x) => x.id !== action.positionId);
      this.closeAt(p, this.feed.price(p.instrument), `manual: ${action.reason}`);
      this.syncExposure();
      return;
    }

    if (toolName === "open_position") {
      const enriched = { ...action, markPrice: this.feed.price(action.instrument) };
      const check = this.risk.validateTradeOpen(enriched, { positions: this.positions });
      if (!check.ok) {
        this.logger.reject("trading", action, check);
        return;
      }
      const pos = {
        id: `T${this.nextId++}`,
        instrument: action.instrument,
        direction: action.direction,
        notional: round(action.notional),
        entry: action.entry,
        stop: action.stop,
        target: action.target ?? null,
      };
      this.positions.push(pos);
      this.syncExposure();
      this.logger.event("trading", "open", { ...pos, signal: action.signal });
      return;
    }

    this.logger.event("trading", "error", { error: `unknown tool ${toolName}` });
  }

  report() {
    return {
      openPositions: this.positions.length,
      realizedPnl: round(this.ledger.realized.trading),
      exposure: round(this.ledger.exposure.trading),
    };
  }
}

function pnlFor(p, exit) {
  const move = (exit - p.entry) / p.entry;
  return p.direction === "long" ? p.notional * move : p.notional * -move;
}
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
