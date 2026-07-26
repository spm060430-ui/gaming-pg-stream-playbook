// A lightweight simulated market. Each card price follows a random walk with
// mild mean-reversion toward its base price, so values fluctuate believably
// without ever running away or collapsing to zero.

// Box–Muller transform for a standard-normal sample.
function gaussian() {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const MAX_HISTORY = 40

// Advance a single card one market tick, returning a NEW card object.
export function tickCard(card) {
  const base = card.basePrice || card.price || 1
  const price = card.price || base
  const volatility = card.volatility ?? 0.02 // ~2% typical per-tick move

  // Mean-reversion: gently pull the price back toward base.
  const reversion = 0.05 * (base - price) / base
  // Small persistent drift gives each card a slight personality (trend).
  const drift = card.drift ?? 0
  const shock = volatility * gaussian()

  let next = price * (1 + reversion + drift + shock)
  next = Math.max(0.01, next) // never negative / zero

  const history = [...(card.history || []), next].slice(-MAX_HISTORY)

  return { ...card, price: next, prevPrice: price, history }
}

export function tickAll(cards) {
  return cards.map(tickCard)
}

// Assign randomized-but-stable market personality when a card is created.
export function marketParams() {
  return {
    // volatility between ~1% and ~4.5%
    volatility: 0.01 + Math.random() * 0.035,
    // tiny drift, biased slightly bullish, in [-0.004, +0.006]
    drift: (Math.random() - 0.4) * 0.01,
  }
}
