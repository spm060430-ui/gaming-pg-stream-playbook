// Number / money formatting helpers.

export function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtMoney(n, { sign = false } = {}) {
  if (n == null || Number.isNaN(n)) return '—'
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const prefix = n < 0 ? '-$' : sign ? '+$' : '$'
  return `${prefix}${s}`
}

export function fmtPct(n, { sign = true } = {}) {
  if (n == null || Number.isNaN(n)) return '—'
  const s = Math.abs(n).toFixed(2)
  const prefix = n < 0 ? '-' : sign ? '+' : ''
  return `${prefix}${s}%`
}

export function fmtQty(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export function fmtCompact(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}
