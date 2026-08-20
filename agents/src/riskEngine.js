// The risk engine — the real guardrails.
//
// Every action an agent's language model proposes is passed through here
// BEFORE it can touch the ledger. The model can propose whatever it likes;
// this code is the gate. If a proposal violates a limit from config.js, it is
// rejected with a machine-readable code and a human-readable reason, and the
// rejection is logged. This is what "the risk controls cannot be
// self-overridden" actually means: they live in code, not in a prompt.
//
// Time windows for the rolling loss limits, in ms of simulation time. In paper
// mode one tick == one hour (see commander.js), so a "day" and "week" are
// measured in those sim-hours.
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

const ok = () => ({ ok: true });
const reject = (code, reason) => ({ ok: false, code, reason });

export class RiskEngine {
  constructor(config, ledger) {
    this.config = config;
    this.ledger = ledger;
  }

  // ---- Portfolio level (Station Commander) ------------------------------

  // Returns the kill-switch verdict for the whole portfolio. When tripped, the
  // Commander freezes BOTH desks and escalates. Losses are negative numbers, so
  // a breach is loss <= -(limit * bankroll).
  checkKillSwitch() {
    const { bankroll, portfolio } = this.config;
    const l = this.ledger;

    const loss24h = l.rollingPnl(DAY_MS);
    const loss7d = l.rollingPnl(WEEK_MS);
    const limit24h = -portfolio.killSwitch.rolling24hLoss * bankroll;
    const limit7d = -portfolio.killSwitch.rolling7dLoss * bankroll;

    if (loss24h <= limit24h) {
      return reject(
        "KILL_24H",
        `24h P&L ${loss24h} breached limit ${round(limit24h)} ` +
          `(${pct(portfolio.killSwitch.rolling24hLoss)} of bankroll).`,
      );
    }
    if (loss7d <= limit7d) {
      return reject(
        "KILL_7D",
        `7d P&L ${loss7d} breached limit ${round(limit7d)} ` +
          `(${pct(portfolio.killSwitch.rolling7dLoss)} of bankroll).`,
      );
    }
    return ok();
  }

  // Would opening `addedExposure` more of risk push combined exposure over the
  // portfolio cap? Checked before any desk is allowed to add risk.
  checkCombinedExposure(addedExposure) {
    const cap = this.config.portfolio.maxCombinedExposure * this.config.bankroll;
    const projected = this.ledger.totalExposure() + addedExposure;
    if (projected > cap + EPS) {
      return reject(
        "EXPOSURE_CAP",
        `Combined exposure ${round(projected)} would exceed cap ${round(cap)} ` +
          `(${pct(this.config.portfolio.maxCombinedExposure)} of bankroll).`,
      );
    }
    return ok();
  }

  // ---- Futures Desk -----------------------------------------------------

  // deskState.positions: array of open positions
  //   { id, instrument, direction, notional, entry, stop }
  validateTradeOpen(action, deskState) {
    const t = this.config.trading;
    const allocated = this.ledger.reserved.trading;

    if (this.ledger.frozen.trading) return reject("FROZEN", "Trading desk is frozen.");

    // Instrument must be one we're allowed to trade.
    if (!t.instruments[action.instrument]) {
      return reject(
        "BAD_INSTRUMENT",
        `${action.instrument} is not in the allowed set ` +
          `(${Object.keys(t.instruments).join(", ")}).`,
      );
    }

    if (!["long", "short"].includes(action.direction)) {
      return reject("BAD_DIRECTION", `direction must be long|short, got ${action.direction}.`);
    }

    // Every position needs a stop, and the stop must be on the correct side of
    // entry and within maxStopDistance.
    if (t.requireStopLoss) {
      if (!isFiniteNum(action.stop) || !isFiniteNum(action.entry)) {
        return reject("NO_STOP", "A numeric entry and stop are required to open a position.");
      }
      const stopOnWrongSide =
        (action.direction === "long" && action.stop >= action.entry) ||
        (action.direction === "short" && action.stop <= action.entry);
      if (stopOnWrongSide) {
        return reject("BAD_STOP", `Stop ${action.stop} is on the wrong side of entry ${action.entry}.`);
      }
      const dist = Math.abs(action.entry - action.stop) / action.entry;
      if (dist > t.maxStopDistance + EPS) {
        return reject(
          "STOP_TOO_WIDE",
          `Stop is ${pct(dist)} from entry, max is ${pct(t.maxStopDistance)}.`,
        );
      }
    }

    // Position size cap per instrument.
    const maxNotional = t.maxPositionPerInstrument * allocated;
    if (!isFiniteNum(action.notional) || action.notional <= 0) {
      return reject("BAD_SIZE", "notional must be a positive number.");
    }
    if (action.notional > maxNotional + EPS) {
      return reject(
        "SIZE_CAP",
        `Notional ${round(action.notional)} exceeds per-instrument cap ` +
          `${round(maxNotional)} (${pct(t.maxPositionPerInstrument)} of allocated).`,
      );
    }

    // Leverage: total notional across positions must stay within maxLeverage.
    const openNotional = sum(deskState.positions.map((p) => p.notional));
    const projectedLeverage = (openNotional + action.notional) / allocated;
    if (projectedLeverage > t.maxLeverage + EPS) {
      return reject(
        "LEVERAGE_CAP",
        `Projected leverage ${projectedLeverage.toFixed(2)}x exceeds max ${t.maxLeverage}x.`,
      );
    }

    // Concurrent position count.
    if (deskState.positions.length >= t.maxConcurrentPositions) {
      return reject(
        "MAX_POSITIONS",
        `Already at ${deskState.positions.length} open positions (max ${t.maxConcurrentPositions}).`,
      );
    }

    // No averaging down: no second position in the same instrument+direction
    // when the existing one is underwater.
    if (!t.allowAveragingDown) {
      const losingSame = deskState.positions.find(
        (p) =>
          p.instrument === action.instrument &&
          p.direction === action.direction &&
          isLosing(p, action.markPrice ?? action.entry),
      );
      if (losingSame) {
        return reject("AVERAGING_DOWN", "Averaging down on a losing position is not allowed.");
      }
    }

    // Session buffers: no new positions in the first/last N minutes.
    if (typeof action.minutesFromOpen === "number" && action.minutesFromOpen < t.session.openBufferMin) {
      return reject("SESSION_OPEN", `No new positions in first ${t.session.openBufferMin} min of the session.`);
    }
    if (typeof action.minutesToClose === "number" && action.minutesToClose < t.session.closeBufferMin) {
      return reject("SESSION_CLOSE", `No new positions in last ${t.session.closeBufferMin} min of the session.`);
    }

    // Daily / weekly loss limits (per desk).
    const dayCheck = this.checkDeskLossLimits("trading", allocated, t.dailyLossLimit, t.weeklyLossLimit);
    if (!dayCheck.ok) return dayCheck;

    // Finally, the portfolio-wide exposure cap.
    return this.checkCombinedExposure(action.notional);
  }

  validateTradeClose(action, deskState) {
    const exists = deskState.positions.some((p) => p.id === action.positionId);
    if (!exists) return reject("NO_POSITION", `No open position with id ${action.positionId}.`);
    return ok(); // closing risk is always allowed
  }

  // ---- Book Desk --------------------------------------------------------

  validateBet(action, deskState) {
    const b = this.config.betting;
    const allocated = this.ledger.reserved.betting;

    if (this.ledger.frozen.betting) return reject("FROZEN", "Betting desk is frozen.");

    if (!b.leagues.includes(action.league)) {
      return reject("BAD_LEAGUE", `${action.league} is not in scope (${b.leagues.join(", ")}).`);
    }
    if (!b.betTypes.includes(action.betType)) {
      return reject("BAD_BETTYPE", `${action.betType} is not an allowed bet type (${b.betTypes.join(", ")}).`);
    }

    // Odds sanity + edge requirement. Decimal odds imply prob = 1/odds (vig in).
    if (!isFiniteNum(action.odds) || action.odds <= 1) {
      return reject("BAD_ODDS", `odds must be decimal > 1, got ${action.odds}.`);
    }
    if (!isFiniteNum(action.modelProb) || action.modelProb <= 0 || action.modelProb >= 1) {
      return reject("BAD_PROB", `modelProb must be in (0,1), got ${action.modelProb}.`);
    }
    const impliedProb = 1 / action.odds;
    const edge = action.modelProb - impliedProb;
    if (edge < b.minEdge - EPS) {
      return reject(
        "NO_EDGE",
        `Edge ${pct(edge)} is below the ${pct(b.minEdge)} minimum (model ${pct(action.modelProb)} vs implied ${pct(impliedProb)}).`,
      );
    }

    // Stake caps. The engine computes the ALLOWED stake and rejects anything
    // larger than the single-bet cap; the agent's proposed stake may be smaller.
    const cap = b.maxStakePerBet * allocated;
    if (!isFiniteNum(action.stake) || action.stake <= 0) {
      return reject("BAD_STAKE", "stake must be a positive number.");
    }
    if (action.stake > cap + EPS) {
      return reject(
        "STAKE_CAP",
        `Stake ${round(action.stake)} exceeds single-bet cap ${round(cap)} (${pct(b.maxStakePerBet)} of allocated).`,
      );
    }

    // No chasing: after a losing day so far, the stake may not exceed the
    // desk's recent average stake. (A simple, code-enforced anti-tilt rule.)
    const dayPnl = this.ledger.rollingPnl(DAY_MS, "betting");
    if (dayPnl < 0 && deskState.recentStakes && deskState.recentStakes.length > 0) {
      const avg = sum(deskState.recentStakes) / deskState.recentStakes.length;
      if (action.stake > avg + EPS) {
        return reject(
          "CHASING",
          `Down ${round(dayPnl)} on the day; stake ${round(action.stake)} exceeds recent average ${round(avg)} — no chasing.`,
        );
      }
    }

    // Daily / weekly loss limits.
    const lossCheck = this.checkDeskLossLimits("betting", allocated, b.dailyLossLimit, b.weeklyLossLimit);
    if (!lossCheck.ok) return lossCheck;

    // Portfolio exposure cap (a bet's exposure is its stake).
    return this.checkCombinedExposure(action.stake);
  }

  // ---- Shared -----------------------------------------------------------

  // Kelly-derived allowed stake for a bet (as an absolute amount), honoring the
  // configured sizing method and always clamped to the single-bet cap.
  suggestedStake(odds, modelProb) {
    const b = this.config.betting;
    const allocated = this.ledger.reserved.betting;
    const cap = b.maxStakePerBet * allocated;

    if (b.stakeSizing === "flat") {
      return round(Math.min(b.flatStake * allocated, cap));
    }
    // fractional Kelly: f* = (bp - q) / b, where b = odds-1, p = modelProb, q = 1-p
    const bOdds = odds - 1;
    const q = 1 - modelProb;
    const fullKelly = (bOdds * modelProb - q) / bOdds;
    const fraction = Math.max(0, fullKelly) * b.kellyFraction;
    return round(Math.min(fraction * allocated, cap));
  }

  checkDeskLossLimits(desk, allocated, dailyLimit, weeklyLimit) {
    const dayPnl = this.ledger.rollingPnl(DAY_MS, desk);
    const weekPnl = this.ledger.rollingPnl(WEEK_MS, desk);
    if (dayPnl <= -dailyLimit * allocated) {
      return reject("DAILY_LOSS", `${desk} down ${round(dayPnl)} today; daily limit is ${round(-dailyLimit * allocated)}.`);
    }
    if (weekPnl <= -weeklyLimit * allocated) {
      return reject("WEEKLY_LOSS", `${desk} down ${round(weekPnl)} this week; weekly limit is ${round(-weeklyLimit * allocated)}.`);
    }
    return ok();
  }
}

// ---- helpers ------------------------------------------------------------
const EPS = 1e-9;
const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const round = (n) => Math.round(n * 100) / 100;
const pct = (f) => `${(f * 100).toFixed(1)}%`;

function isLosing(position, markPrice) {
  if (position.direction === "long") return markPrice < position.entry;
  return markPrice > position.entry;
}
