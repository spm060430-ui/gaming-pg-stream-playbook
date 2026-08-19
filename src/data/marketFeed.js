// MarketFeed — orchestrates a provider into a live, subscribable price store.
//
// Responsibilities:
//  * pick a reachable provider (Binance -> Coinbase), else go offline/sim
//  * seed quotes over REST, then keep them fresh with a slow REST poll
//  * layer real-time WebSocket ticks on top for second-by-second motion
//  * expose an immutable snapshot + subscribe(), consumable via
//    React's useSyncExternalStore
//
// Snapshot shape:
//   { status, providerId, providerLabel, updatedAt, prices: { [sym]: PxRow } }
// PxRow = { price, prevPrice, open, high, low, volume, changePct }

import { useSyncExternalStore } from 'react'
import { PROVIDERS, SYMBOLS, detectProvider } from './providers.js'

const POLL_MS = 6000 // REST refresh of 24h stats
const FLUSH_MS = 150 // max render cadence
const RETRY_MS = 12000 // re-detect when offline

class MarketFeed {
  constructor() {
    this.status = 'idle' // idle | connecting | live | reconnecting | offline | sim
    this.provider = null
    this.symbols = SYMBOLS
    this.px = new Map() // sym -> PxRow (mutable working copy)
    this.listeners = new Set()
    this._snapshot = this._buildSnapshot()
    this._dirty = false
    this._flushTimer = null
    this._pollTimer = null
    this._retryTimer = null
    this._closeStream = null
    this._started = false
    this._mode = 'live'
  }

  /* ---- public API ---- */

  start(mode = 'live') {
    this._mode = mode
    if (this._started) {
      this.restart(mode)
      return
    }
    this._started = true
    this._connect()
  }

  restart(mode = this._mode) {
    this._mode = mode
    this._teardownConnection()
    this.status = 'connecting'
    this._markDirty(true)
    this._connect()
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this._snapshot

  getProvider() {
    return this.provider
  }

  price(symbol) {
    const row = this.px.get(symbol)
    return row ? row.price : null
  }

  async getCandles(symbol, opts) {
    const p = this.provider || PROVIDERS.sim
    return p.getCandles(symbol, opts)
  }

  /* ---- connection lifecycle ---- */

  async _connect() {
    this.status = 'connecting'
    this._markDirty(true)

    let provider
    if (this._mode === 'sim') {
      provider = PROVIDERS.sim
    } else {
      provider = await detectProvider()
      if (!provider) {
        this.status = 'offline'
        this._markDirty(true)
        this._scheduleRetry()
        return
      }
    }
    this.provider = provider
    this.status = provider.id === 'sim' ? 'sim' : 'live'

    await this._pollQuotes() // seed
    this._startPolling()
    this._openStream()
    this._markDirty(true)
  }

  _scheduleRetry() {
    clearTimeout(this._retryTimer)
    if (this._mode === 'sim') return
    this._retryTimer = setTimeout(() => this._connect(), RETRY_MS)
  }

  _teardownConnection() {
    if (this._closeStream) {
      try {
        this._closeStream()
      } catch {
        /* noop */
      }
      this._closeStream = null
    }
    clearInterval(this._pollTimer)
    clearTimeout(this._retryTimer)
    this._pollTimer = null
    this._retryTimer = null
  }

  _startPolling() {
    clearInterval(this._pollTimer)
    this._pollTimer = setInterval(() => this._pollQuotes(), POLL_MS)
  }

  async _pollQuotes() {
    if (!this.provider) return
    try {
      const quotes = await this.provider.getQuotes(this.symbols)
      for (const sym of this.symbols) {
        const q = quotes[sym]
        if (!q) continue
        const existing = this.px.get(sym)
        const prevPrice = existing ? existing.price : q.price
        this.px.set(sym, {
          price: q.price,
          prevPrice,
          open: q.open,
          high: Math.max(q.high, q.price),
          low: q.low ? Math.min(q.low, q.price) : q.price,
          volume: q.volume,
          changePct: q.open ? ((q.price - q.open) / q.open) * 100 : 0,
        })
      }
      if (this.status !== 'sim') this.status = 'live'
      this._markDirty(true)
    } catch {
      // Polling failed. If we have no data at all, drop offline & retry.
      if (this.px.size === 0 && this._mode !== 'sim') {
        this.status = 'offline'
        this._teardownConnection()
        this._scheduleRetry()
      } else {
        this.status = this.status === 'sim' ? 'sim' : 'reconnecting'
      }
      this._markDirty(true)
    }
  }

  _openStream() {
    if (!this.provider) return
    if (this._closeStream) {
      try {
        this._closeStream()
      } catch {
        /* noop */
      }
    }
    this._closeStream = this.provider.openStream(this.symbols, (tick) => {
      const row = this.px.get(tick.symbol)
      if (!row) return
      if (!Number.isFinite(tick.price) || tick.price <= 0) return
      row.prevPrice = row.price
      row.price = tick.price
      if (tick.price > row.high) row.high = tick.price
      if (tick.price < row.low) row.low = tick.price
      row.changePct = row.open ? ((tick.price - row.open) / row.open) * 100 : row.changePct
      this._markDirty(false)
    })
  }

  /* ---- snapshot / notification ---- */

  _buildSnapshot() {
    const prices = {}
    if (this.px) for (const [sym, row] of this.px) prices[sym] = { ...row }
    return {
      status: this.status,
      providerId: this.provider ? this.provider.id : null,
      providerLabel: this.provider ? this.provider.label : null,
      updatedAt: Date.now(),
      prices,
    }
  }

  _markDirty(immediate) {
    this._dirty = true
    if (immediate) {
      this._flush()
      return
    }
    if (this._flushTimer) return
    this._flushTimer = setTimeout(() => this._flush(), FLUSH_MS)
  }

  _flush() {
    clearTimeout(this._flushTimer)
    this._flushTimer = null
    if (!this._dirty) return
    this._dirty = false
    this._snapshot = this._buildSnapshot()
    for (const fn of this.listeners) fn()
  }
}

export const marketFeed = new MarketFeed()

// React binding.
export function useMarketFeed() {
  return useSyncExternalStore(
    (cb) => marketFeed.subscribe(cb),
    marketFeed.getSnapshot,
    marketFeed.getSnapshot
  )
}
