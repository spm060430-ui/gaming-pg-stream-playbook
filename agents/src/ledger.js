// The master ledger. Holds the bankroll, the capital reserved to each desk,
// realized P&L, and a timestamped history of P&L events used by the rolling
// kill-switch windows. The Station Commander owns the one instance of this.

export class Ledger {
  constructor(config) {
    this.config = config;
    this.bankroll = config.bankroll;
    this.startingBankroll = config.bankroll;

    // Reserved capital per desk. Reserved, not shared: a dollar allocated to
    // trading is unavailable to betting and vice-versa.
    this.reserved = {
      trading: round(config.bankroll * config.allocations.trading),
      betting: round(config.bankroll * config.allocations.betting),
    };

    // Realized P&L per desk (cumulative).
    this.realized = { trading: 0, betting: 0 };

    // Open exposure per desk — capital currently at risk in live positions/bets.
    this.exposure = { trading: 0, betting: 0 };

    // Frozen desks cannot act until the Commander unfreezes them.
    this.frozen = { trading: false, betting: false };

    // Append-only log of realized P&L events: { ts, desk, amount }.
    // amount is signed (negative = loss). Drives the rolling-window checks.
    this.pnlHistory = [];

    // "Now" in the simulation. Advanced by the Commander each tick so the
    // rolling windows are deterministic in paper mode. Real deployments would
    // use Date.now() instead.
    this.now = 0;
  }

  reserve() {
    return this.config.bankroll - this.reserved.trading - this.reserved.betting;
  }

  totalExposure() {
    return this.exposure.trading + this.exposure.betting;
  }

  // Record a realized gain/loss for a desk. Updates bankroll and history.
  recordPnl(desk, amount) {
    this.realized[desk] = round(this.realized[desk] + amount);
    this.bankroll = round(this.bankroll + amount);
    this.pnlHistory.push({ ts: this.now, desk, amount: round(amount) });
  }

  setExposure(desk, amount) {
    this.exposure[desk] = round(amount);
  }

  // Sum of realized P&L within the last `windowMs` of sim time. Pass a desk
  // name to restrict to one desk; omit it for the whole portfolio.
  rollingPnl(windowMs, desk = null) {
    const cutoff = this.now - windowMs;
    return round(
      this.pnlHistory
        .filter((e) => e.ts >= cutoff && (desk === null || e.desk === desk))
        .reduce((sum, e) => sum + e.amount, 0),
    );
  }

  snapshot() {
    return {
      bankroll: this.bankroll,
      startingBankroll: this.startingBankroll,
      reserved: { ...this.reserved },
      reserve: round(this.reserve()),
      realized: { ...this.realized },
      exposure: { ...this.exposure },
      totalExposure: round(this.totalExposure()),
      frozen: { ...this.frozen },
    };
  }
}

export function round(n) {
  return Math.round(n * 100) / 100;
}
