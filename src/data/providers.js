// Market-data providers for DayTrader.
//
// Each provider exposes the same shape so the feed can swap between them:
//   id, label
//   probe()                      -> Promise<boolean>   (is it reachable here?)
//   getQuotes(symbols)           -> Promise<{ [sym]: Quote }>
//   getCandles(sym, opts)        -> Promise<Candle[]>
//   openStream(symbols, onTick)  -> () => void          (returns a close fn)
//
// Quote  = { price, open, high, low, volume }   (open = ~24h-ago price)
// Candle = { t, o, h, l, c }                     (t = ms epoch)
// onTick = ({ symbol, price }) => void
//
// `symbol` everywhere is our internal ticker, e.g. "BTC". Providers map it
// to their own product id (Binance "BTCUSDT", Coinbase "BTC-USD").

// The tradable universe. These pairs exist on both Binance and Coinbase.
export const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'LTC', name: 'Litecoin' },
  { symbol: 'DOT', name: 'Polkadot' },
  { symbol: 'BCH', name: 'Bitcoin Cash' },
  { symbol: 'XLM', name: 'Stellar' },
  { symbol: 'ATOM', name: 'Cosmos' },
  { symbol: 'ETC', name: 'Ethereum Classic' },
  { symbol: 'UNI', name: 'Uniswap' },
  { symbol: 'AAVE', name: 'Aave' },
]

export const SYMBOLS = ASSETS.map((a) => a.symbol)
export const NAME_BY_SYMBOL = Object.fromEntries(ASSETS.map((a) => [a.symbol, a.name]))

// Candle intervals we support in the UI -> provider-specific values.
export const INTERVALS = [
  { id: '1m', label: '1m', binance: '1m', coinbaseGranularity: 60 },
  { id: '5m', label: '5m', binance: '5m', coinbaseGranularity: 300 },
  { id: '15m', label: '15m', binance: '15m', coinbaseGranularity: 900 },
  { id: '1h', label: '1H', binance: '1h', coinbaseGranularity: 3600 },
]

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])

async function getJSON(url, { timeout = 9000 } = {}) {
  const res = await withTimeout(fetch(url, { headers: { accept: 'application/json' } }), timeout, url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

/* ------------------------------------------------------------------ */
/* Binance                                                             */
/* ------------------------------------------------------------------ */

const binance = {
  id: 'binance',
  label: 'Binance',
  base: 'https://api.binance.com',
  ws: 'wss://stream.binance.com:9443',
  pair: (s) => `${s}USDT`,
  fromPair: (p) => p.replace(/USDT$/i, '').toUpperCase(),

  async probe() {
    try {
      await getJSON(`${this.base}/api/v3/ping`, { timeout: 6000 })
      return true
    } catch {
      return false
    }
  },

  async getQuotes(symbols) {
    const pairs = symbols.map((s) => this.pair(s))
    const url = `${this.base}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}`
    const rows = await getJSON(url)
    const out = {}
    for (const r of rows) {
      const sym = this.fromPair(r.symbol)
      const price = parseFloat(r.lastPrice)
      out[sym] = {
        price,
        open: parseFloat(r.openPrice) || price,
        high: parseFloat(r.highPrice) || price,
        low: parseFloat(r.lowPrice) || price,
        volume: parseFloat(r.quoteVolume) || 0,
      }
    }
    return out
  },

  async getCandles(symbol, { interval = '1m', limit = 120 } = {}) {
    const iv = INTERVALS.find((i) => i.id === interval)?.binance || '1m'
    const url = `${this.base}/api/v3/klines?symbol=${this.pair(symbol)}&interval=${iv}&limit=${limit}`
    const rows = await getJSON(url)
    return rows.map((k) => ({
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
    }))
  },

  openStream(symbols, onTick) {
    const streams = symbols.map((s) => `${this.pair(s).toLowerCase()}@miniTicker`).join('/')
    const url = `${this.ws}/stream?streams=${streams}`
    let ws
    let closed = false
    try {
      ws = new WebSocket(url)
    } catch {
      return () => {}
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        const d = msg.data
        if (!d || !d.s) return
        onTick({ symbol: this.fromPair(d.s), price: parseFloat(d.c) })
      } catch {
        /* ignore malformed frame */
      }
    }
    return () => {
      closed = true
      try {
        ws && ws.close()
      } catch {
        /* noop */
      }
      void closed
    }
  },
}

/* ------------------------------------------------------------------ */
/* Coinbase (Exchange public API)                                      */
/* ------------------------------------------------------------------ */

const coinbase = {
  id: 'coinbase',
  label: 'Coinbase',
  base: 'https://api.exchange.coinbase.com',
  ws: 'wss://ws-feed.exchange.coinbase.com',
  pair: (s) => `${s}-USD`,
  fromPair: (p) => p.replace(/-USD$/i, '').toUpperCase(),

  async probe() {
    try {
      await getJSON(`${this.base}/products/BTC-USD/ticker`, { timeout: 6000 })
      return true
    } catch {
      return false
    }
  },

  async getQuotes(symbols) {
    const entries = await Promise.all(
      symbols.map(async (s) => {
        try {
          const stats = await getJSON(`${this.base}/products/${this.pair(s)}/stats`, { timeout: 8000 })
          const price = parseFloat(stats.last)
          return [
            s,
            {
              price,
              open: parseFloat(stats.open) || price,
              high: parseFloat(stats.high) || price,
              low: parseFloat(stats.low) || price,
              volume: parseFloat(stats.volume) || 0,
            },
          ]
        } catch {
          return [s, null]
        }
      })
    )
    const out = {}
    for (const [s, q] of entries) if (q) out[s] = q
    return out
  },

  async getCandles(symbol, { interval = '1m', limit = 120 } = {}) {
    const g = INTERVALS.find((i) => i.id === interval)?.coinbaseGranularity || 60
    const end = Math.floor(Date.now() / 1000)
    const start = end - g * limit
    const url = `${this.base}/products/${this.pair(symbol)}/candles?granularity=${g}&start=${start}&end=${end}`
    const rows = await getJSON(url)
    // Coinbase rows: [ time, low, high, open, close, volume ], newest first.
    return rows
      .map((k) => ({ t: k[0] * 1000, o: k[3], h: k[2], l: k[1], c: k[4] }))
      .sort((a, b) => a.t - b.t)
  },

  openStream(symbols, onTick) {
    const url = this.ws
    let ws
    try {
      ws = new WebSocket(url)
    } catch {
      return () => {}
    }
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: symbols.map((s) => this.pair(s)),
          channels: ['ticker'],
        })
      )
    }
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data)
        if (d.type !== 'ticker' || !d.product_id || d.price == null) return
        onTick({ symbol: this.fromPair(d.product_id), price: parseFloat(d.price) })
      } catch {
        /* ignore */
      }
    }
    return () => {
      try {
        ws && ws.close()
      } catch {
        /* noop */
      }
    }
  },
}

/* ------------------------------------------------------------------ */
/* Simulated (offline / demo) provider                                 */
/* ------------------------------------------------------------------ */
// Used only when no live feed is reachable, or when the user explicitly
// switches to demo mode. Prices are clearly labelled SIM in the UI.

const SEED_PRICES = {
  BTC: 64000, ETH: 3100, SOL: 145, XRP: 0.52, DOGE: 0.12, ADA: 0.45,
  AVAX: 28, LINK: 14, LTC: 72, DOT: 6.2, BCH: 380, XLM: 0.11,
  ATOM: 7.5, ETC: 24, UNI: 8.1, AAVE: 95,
}

const sim = {
  id: 'sim',
  label: 'Simulated',
  _state: {},
  _ensure(symbols) {
    for (const s of symbols) {
      if (!this._state[s]) {
        const base = SEED_PRICES[s] ?? 100
        this._state[s] = { price: base, open: base, high: base, low: base }
      }
    }
  },
  _step(s) {
    const st = this._state[s]
    // Gentle geometric random walk with a touch of mean reversion.
    const drift = (st.open - st.price) * 0.0005
    const shock = (Math.random() - 0.5) * 0.004 * st.price
    st.price = Math.max(0.0001, st.price + drift + shock)
    st.high = Math.max(st.high, st.price)
    st.low = Math.min(st.low, st.price)
    return st.price
  },
  async probe() {
    return true
  },
  async getQuotes(symbols) {
    this._ensure(symbols)
    const out = {}
    for (const s of symbols) {
      const st = this._state[s]
      out[s] = { price: st.price, open: st.open, high: st.high, low: st.low, volume: 0 }
    }
    return out
  },
  async getCandles(symbol, { interval = '1m', limit = 120 } = {}) {
    this._ensure([symbol])
    const ivMs = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 }[interval] || 60000
    const now = Date.now()
    let price = this._state[symbol].open
    const out = []
    for (let i = limit - 1; i >= 0; i--) {
      const o = price
      const c = Math.max(0.0001, o * (1 + (Math.random() - 0.5) * 0.01))
      const h = Math.max(o, c) * (1 + Math.random() * 0.004)
      const l = Math.min(o, c) * (1 - Math.random() * 0.004)
      out.push({ t: now - i * ivMs, o, h, l, c })
      price = c
    }
    return out
  },
  openStream(symbols, onTick) {
    this._ensure(symbols)
    const id = setInterval(() => {
      for (const s of symbols) onTick({ symbol: s, price: this._step(s) })
    }, 900)
    return () => clearInterval(id)
  },
}

export const PROVIDERS = { binance, coinbase, sim }

// Try live providers in order of preference; return the first reachable one.
export async function detectProvider(preferred) {
  const order = preferred
    ? [preferred, ...['binance', 'coinbase'].filter((id) => id !== preferred)]
    : ['binance', 'coinbase']
  for (const id of order) {
    const p = PROVIDERS[id]
    if (p && (await p.probe())) return p
  }
  return null
}
