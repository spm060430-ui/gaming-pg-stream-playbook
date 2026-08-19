// React binding for the trading engine: holds account state, persists it,
// exposes actions, and fills working limit orders as live prices move.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as P from './portfolio.js'
import { loadAccount, saveAccount } from './storage.js'
import { useMarketFeed, marketFeed } from '../data/marketFeed.js'

const AccountCtx = createContext(null)

export function AccountProvider({ children }) {
  const [state, setState] = useState(loadAccount)
  const [toast, setToast] = useState(null)
  const feed = useMarketFeed()
  const prices = feed.prices

  const stateRef = useRef(state)
  stateRef.current = state

  // Persist on every change (cheap; state is small).
  useEffect(() => {
    saveAccount(state)
  }, [state])

  const notify = useCallback((type, msg) => {
    setToast({ id: Math.random().toString(36).slice(2), type, msg })
  }, [])

  // Fill working limit orders whenever prices move.
  useEffect(() => {
    const cur = stateRef.current
    if (cur.openOrders.length === 0) return
    const { state: next, fills } = P.processLimitFills(cur, prices)
    if (fills.length > 0) {
      setState(next)
      const f = fills[0]
      notify(
        'fill',
        fills.length === 1
          ? `Limit ${f.side} filled: ${f.qty} ${f.symbol} @ ${f.price}`
          : `${fills.length} limit orders filled`
      )
    }
  }, [prices, notify])

  /* ---------- actions ---------- */

  const submitMarket = useCallback(({ symbol, side, qty }) => {
    const price = marketFeed.price(symbol)
    const res = P.marketOrder(stateRef.current, { symbol, side, qty, price })
    if (res.error) return res
    setState(res.state)
    notify('order', `${side} ${qty} ${symbol} @ ${price}`)
    return res
  }, [notify])

  const submitLimit = useCallback(({ symbol, side, qty, limitPrice }) => {
    const res = P.placeLimit(stateRef.current, { symbol, side, qty, limitPrice })
    if (res.error) return res
    setState(res.state)
    notify('order', `Limit ${side} placed: ${qty} ${symbol} @ ${limitPrice}`)
    return res
  }, [notify])

  const cancelOrder = useCallback((id) => {
    const res = P.cancelLimit(stateRef.current, id)
    setState(res.state)
  }, [])

  const liquidateAll = useCallback(() => {
    const res = P.liquidateAll(stateRef.current, marketFeed.getSnapshot().prices)
    setState(res.state)
    notify('order', 'Liquidated all positions')
  }, [notify])

  const resetAccount = useCallback(() => {
    setState(P.createAccount())
    notify('order', 'Account reset to $100,000')
  }, [notify])

  /* ---------- derived valuation ---------- */

  const valuation = useMemo(() => {
    const positionsValue = P.positionsValue(state, prices)
    const unrealized = P.unrealizedPL(state, prices)
    const eq = state.cash + state.reservedCash + positionsValue
    const totalPL = eq - state.startingCash
    return {
      cash: state.cash,
      reservedCash: state.reservedCash,
      positionsValue,
      unrealized,
      realized: state.realized,
      equity: eq,
      buyingPower: state.cash,
      totalPL,
      totalPLPct: state.startingCash ? (totalPL / state.startingCash) * 100 : 0,
    }
  }, [state, prices])

  const value = useMemo(
    () => ({
      state,
      prices,
      feed,
      valuation,
      toast,
      dismissToast: () => setToast(null),
      submitMarket,
      submitLimit,
      cancelOrder,
      liquidateAll,
      resetAccount,
    }),
    [state, prices, feed, valuation, toast, submitMarket, submitLimit, cancelOrder, liquidateAll, resetAccount]
  )

  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>
}

export function useAccount() {
  const ctx = useContext(AccountCtx)
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>')
  return ctx
}
