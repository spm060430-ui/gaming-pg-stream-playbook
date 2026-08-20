// A simulated market feed for the Futures Desk. Each instrument follows a
// random walk with mild mean-reversion — the same believable-but-safe engine
// the PokéStock app uses for card prices, adapted to index/ETF proxies. This
// is the PAPER-MODE data source. A live deployment would replace this module
// with a real market-data client; nothing else in the system needs to change.

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const MAX_HISTORY = 40;

export class MarketFeed {
  constructor(instruments) {
    // instruments: config.trading.instruments
    this.state = {};
    // Rough, plausible starting prices for the ETF proxies.
    const seed = { GOLD: 215, SP500: 545, NASDAQ: 470 };
    for (const key of Object.keys(instruments)) {
      const base = seed[key] ?? 100;
      this.state[key] = {
        key,
        symbol: instruments[key].symbol,
        label: instruments[key].label,
        base,
        price: base,
        prevPrice: base,
        volatility: 0.008 + Math.random() * 0.012, // ~0.8%–2% per tick
        drift: (Math.random() - 0.45) * 0.004,
        history: [base],
      };
    }
  }

  tick() {
    for (const inst of Object.values(this.state)) {
      const reversion = (0.04 * (inst.base - inst.price)) / inst.base;
      const shock = inst.volatility * gaussian();
      let next = inst.price * (1 + reversion + inst.drift + shock);
      next = Math.max(0.01, next);
      inst.prevPrice = inst.price;
      inst.price = round4(next);
      inst.history = [...inst.history, inst.price].slice(-MAX_HISTORY);
    }
  }

  // A compact quote object for one instrument, for the agent's context.
  quote(key) {
    const i = this.state[key];
    const changePct = (i.price - i.prevPrice) / i.prevPrice;
    return {
      instrument: key,
      symbol: i.symbol,
      price: i.price,
      changePct: round4(changePct),
      // A tiny momentum read the agent can use as (toy) signal.
      trend: round4((i.price - i.history[0]) / i.history[0]),
    };
  }

  quotes() {
    return Object.keys(this.state).map((k) => this.quote(k));
  }

  price(key) {
    return this.state[key].price;
  }
}

const round4 = (n) => Math.round(n * 10000) / 10000;
