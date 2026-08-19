// Pure trading-engine logic. No React, no side effects — every function
// takes the account state and returns a new state (plus a result where useful).
//
// Money model (all long-only for now):
//   state.cash          available buying power
//   state.reservedCash  cash locked behind open BUY-limit orders
//   state.positions[sym] = { qty, basis, reserved }
//        qty      total units held
//        basis    total cost basis (includes buy-side fees)
//        reserved units locked behind open SELL-limit orders
//   state.realized      cumulative realized P/L
//   state.orders        executed fills (newest first)
//   state.openOrders    working limit orders
//
// avgCost for a position is basis / qty (derived, never stored).

export const STARTING_CASH = 100000
export const FEE_RATE = 0.001 // 0.1% taker fee, charged on both sides

let seq = 0
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function createAccount(startingCash = STARTING_CASH) {
  return {
    version: 1,
    startingCash,
    cash: startingCash,
    reservedCash: 0,
    positions: {},
    realized: 0,
    orders: [],
    openOrders: [],
    createdAt: Date.now(),
  }
}

/* ---------- derived helpers (pure, read-only) ---------- */

export const avgCost = (pos) => (pos && pos.qty > 0 ? pos.basis / pos.qty : 0)

export const availableQty = (pos) => (pos ? pos.qty - (pos.reserved || 0) : 0)

export function positionsValue(state, prices) {
  let v = 0
  for (const [sym, pos] of Object.entries(state.positions)) {
    const px = prices[sym]?.price
    if (px != null) v += pos.qty * px
  }
  return v
}

export function unrealizedPL(state, prices) {
  let v = 0
  for (const [sym, pos] of Object.entries(state.positions)) {
    const px = prices[sym]?.price
    if (px != null && pos.qty > 0) v += (px - avgCost(pos)) * pos.qty
  }
  return v
}

export function equity(state, prices) {
  return state.cash + state.reservedCash + positionsValue(state, prices)
}

export function buyingPower(state) {
  return state.cash
}

/* ---------- mutations (return { state, error?, order? }) ---------- */

const clonePos = (p) => (p ? { ...p } : { qty: 0, basis: 0, reserved: 0 })

function applyBuy(state, sym, qty, price) {
  const value = qty * price
  const fee = value * FEE_RATE
  const totalCost = value + fee
  if (totalCost > state.cash + 1e-9) return { error: 'Insufficient buying power.' }
  const positions = { ...state.positions }
  const pos = clonePos(positions[sym])
  pos.qty += qty
  pos.basis += totalCost
  positions[sym] = pos
  const order = {
    id: uid(), ts: Date.now(), symbol: sym, side: 'BUY', type: 'MARKET',
    qty, price, value, fee, realized: 0,
  }
  return {
    state: {
      ...state,
      cash: state.cash - totalCost,
      positions,
      orders: [order, ...state.orders].slice(0, 500),
    },
    order,
  }
}

function applySell(state, sym, qty, price, { fromReserve = false } = {}) {
  const pos = state.positions[sym]
  if (!pos || pos.qty <= 0) return { error: 'No position to sell.' }
  const avail = fromReserve ? pos.qty : availableQty(pos)
  if (qty > avail + 1e-9) return { error: 'Not enough available units to sell.' }
  const value = qty * price
  const fee = value * FEE_RATE
  const proceeds = value - fee
  const cost = avgCost(pos) * qty
  const realizedDelta = proceeds - cost

  const positions = { ...state.positions }
  const np = clonePos(pos)
  np.qty -= qty
  np.basis -= cost
  if (fromReserve) np.reserved = Math.max(0, (np.reserved || 0) - qty)
  if (np.qty <= 1e-9) {
    delete positions[sym]
  } else {
    positions[sym] = np
  }
  const order = {
    id: uid(), ts: Date.now(), symbol: sym, side: 'SELL', type: 'MARKET',
    qty, price, value, fee, realized: realizedDelta,
  }
  return {
    state: {
      ...state,
      cash: state.cash + proceeds,
      positions,
      realized: state.realized + realizedDelta,
      orders: [order, ...state.orders].slice(0, 500),
    },
    order,
  }
}

// Execute an immediate market order.
export function marketOrder(state, { symbol, side, qty, price }) {
  qty = Number(qty)
  price = Number(price)
  if (!(qty > 0)) return { error: 'Quantity must be positive.' }
  if (!(price > 0)) return { error: 'No live price available.' }
  return side === 'BUY' ? applyBuy(state, symbol, qty, price) : applySell(state, symbol, qty, price)
}

// Place a working limit order (reserves cash for buys, units for sells).
export function placeLimit(state, { symbol, side, qty, limitPrice }) {
  qty = Number(qty)
  limitPrice = Number(limitPrice)
  if (!(qty > 0)) return { error: 'Quantity must be positive.' }
  if (!(limitPrice > 0)) return { error: 'Limit price must be positive.' }

  if (side === 'BUY') {
    const reserve = qty * limitPrice * (1 + FEE_RATE)
    if (reserve > state.cash + 1e-9) return { error: 'Insufficient buying power to reserve.' }
    const openOrder = {
      id: uid(), ts: Date.now(), symbol, side, type: 'LIMIT', qty, limitPrice, reserve,
    }
    return {
      state: {
        ...state,
        cash: state.cash - reserve,
        reservedCash: state.reservedCash + reserve,
        openOrders: [openOrder, ...state.openOrders],
      },
      order: openOrder,
    }
  }
  // SELL limit — lock units.
  const pos = state.positions[symbol]
  if (!pos || availableQty(pos) < qty - 1e-9) return { error: 'Not enough available units to reserve.' }
  const positions = { ...state.positions }
  const np = clonePos(pos)
  np.reserved = (np.reserved || 0) + qty
  positions[symbol] = np
  const openOrder = { id: uid(), ts: Date.now(), symbol, side, type: 'LIMIT', qty, limitPrice }
  return {
    state: { ...state, positions, openOrders: [openOrder, ...state.openOrders] },
    order: openOrder,
  }
}

export function cancelLimit(state, id) {
  const order = state.openOrders.find((o) => o.id === id)
  if (!order) return { state }
  const openOrders = state.openOrders.filter((o) => o.id !== id)
  if (order.side === 'BUY') {
    return {
      state: {
        ...state,
        openOrders,
        cash: state.cash + order.reserve,
        reservedCash: Math.max(0, state.reservedCash - order.reserve),
      },
    }
  }
  // SELL — release locked units.
  const positions = { ...state.positions }
  const pos = positions[order.symbol]
  if (pos) {
    positions[order.symbol] = { ...pos, reserved: Math.max(0, (pos.reserved || 0) - order.qty) }
  }
  return { state: { ...state, openOrders, positions } }
}

// Fill any working limit orders whose trigger price has been reached.
// Returns { state, fills: [] }.
export function processLimitFills(state, prices) {
  const ready = state.openOrders.filter((o) => {
    const px = prices[o.symbol]?.price
    if (px == null) return false
    return o.side === 'BUY' ? px <= o.limitPrice : px >= o.limitPrice
  })
  if (ready.length === 0) return { state, fills: [] }

  let next = state
  const fills = []
  for (const o of ready) {
    // Remove from open orders first, releasing its reservation.
    if (o.side === 'BUY') {
      next = {
        ...next,
        openOrders: next.openOrders.filter((x) => x.id !== o.id),
        cash: next.cash + o.reserve,
        reservedCash: Math.max(0, next.reservedCash - o.reserve),
      }
      const res = applyBuy(next, o.symbol, o.qty, o.limitPrice)
      if (!res.error) {
        next = res.state
        fills.push({ ...res.order, type: 'LIMIT' })
        // tag the recorded order as a limit fill
        next.orders[0].type = 'LIMIT'
      }
    } else {
      // release reservation, then sell from holdings
      const positions = { ...next.positions }
      const pos = positions[o.symbol]
      if (pos) positions[o.symbol] = { ...pos, reserved: Math.max(0, (pos.reserved || 0) - o.qty) }
      next = { ...next, positions, openOrders: next.openOrders.filter((x) => x.id !== o.id) }
      const res = applySell(next, o.symbol, o.qty, o.limitPrice)
      if (!res.error) {
        next = res.state
        next.orders[0].type = 'LIMIT'
        fills.push({ ...res.order, type: 'LIMIT' })
      }
    }
  }
  return { state: next, fills }
}

// Liquidate everything at current prices (market sell all positions).
export function liquidateAll(state, prices) {
  let next = state
  for (const sym of Object.keys(state.positions)) {
    const pos = next.positions[sym]
    if (!pos || pos.qty <= 0) continue
    const px = prices[sym]?.price
    if (px == null) continue
    const res = applySell(next, sym, pos.qty, px, { fromReserve: true })
    if (!res.error) next = res.state
  }
  return { state: next }
}
