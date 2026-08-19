// localStorage persistence for the trading account.
import { createAccount } from './portfolio.js'

const KEY = 'daytrader.account.v1'
const PREFS_KEY = 'daytrader.prefs.v1'

export function loadAccount() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return createAccount()
    const data = JSON.parse(raw)
    // Basic shape guard — fall back to a fresh account if corrupted.
    if (typeof data !== 'object' || data == null || typeof data.cash !== 'number') {
      return createAccount()
    }
    return {
      ...createAccount(data.startingCash),
      ...data,
      positions: data.positions || {},
      orders: Array.isArray(data.orders) ? data.orders : [],
      openOrders: Array.isArray(data.openOrders) ? data.openOrders : [],
    }
  } catch {
    return createAccount()
  }
}

export function saveAccount(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}
