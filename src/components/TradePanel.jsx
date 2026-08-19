// Order ticket: market/limit buys and sells by USD notional.
import { useEffect, useMemo, useState } from 'react'
import { useAccount } from '../engine/account.jsx'
import { FEE_RATE, availableQty, avgCost } from '../engine/portfolio.js'
import { fmtMoney, fmtPrice, fmtQty } from '../utils/format.js'

export default function TradePanel({ symbol }) {
  const { prices, state, valuation, submitMarket, submitLimit } = useAccount()
  const [side, setSide] = useState('BUY')
  const [type, setType] = useState('MARKET')
  const [amount, setAmount] = useState('')
  const [limit, setLimit] = useState('')
  const [error, setError] = useState('')

  const livePrice = prices[symbol]?.price ?? null
  const pos = state.positions[symbol]
  const posQty = pos ? pos.qty : 0
  const posAvail = availableQty(pos)

  // Seed the limit field with the live price when switching to limit / symbol.
  useEffect(() => {
    if (type === 'LIMIT' && livePrice != null && !limit) {
      setLimit(String(Number(livePrice.toPrecision(6))))
    }
  }, [type, livePrice, limit])

  // Reset the ticket when the symbol changes.
  useEffect(() => {
    setAmount('')
    setLimit('')
    setError('')
  }, [symbol])

  const effPrice = type === 'LIMIT' ? Number(limit) : livePrice
  const usd = Number(amount)
  const qty = effPrice > 0 && usd > 0 ? usd / effPrice : 0
  const fee = usd > 0 ? usd * FEE_RATE : 0
  const total = side === 'BUY' ? usd + fee : usd - fee

  const posValue = posQty * (livePrice ?? 0)

  const setPct = (pct) => {
    setError('')
    if (side === 'BUY') {
      const bp = valuation.buyingPower
      setAmount(((bp * pct) / (1 + FEE_RATE)).toFixed(2))
    } else {
      setAmount((posValue * pct).toFixed(2))
    }
  }

  const disabled = useMemo(() => {
    if (!(usd > 0)) return true
    if (type === 'LIMIT' && !(Number(limit) > 0)) return true
    if (type === 'MARKET' && !(livePrice > 0)) return true
    return false
  }, [usd, type, limit, livePrice])

  const submit = () => {
    setError('')
    const q = effPrice > 0 ? usd / effPrice : 0
    if (!(q > 0)) {
      setError('Enter a valid amount.')
      return
    }
    let res
    if (type === 'MARKET') {
      res = submitMarket({ symbol, side, qty: q })
    } else {
      res = submitLimit({ symbol, side, qty: q, limitPrice: Number(limit) })
    }
    if (res?.error) {
      setError(res.error)
      return
    }
    setAmount('')
  }

  return (
    <div className="ticket card">
      <div className="seg side-seg">
        <button className={`seg-btn buy ${side === 'BUY' ? 'active' : ''}`} onClick={() => setSide('BUY')}>
          Buy
        </button>
        <button className={`seg-btn sell ${side === 'SELL' ? 'active' : ''}`} onClick={() => setSide('SELL')}>
          Sell
        </button>
      </div>

      <div className="seg type-seg">
        <button className={`seg-btn ${type === 'MARKET' ? 'active' : ''}`} onClick={() => setType('MARKET')}>
          Market
        </button>
        <button className={`seg-btn ${type === 'LIMIT' ? 'active' : ''}`} onClick={() => setType('LIMIT')}>
          Limit
        </button>
      </div>

      <div className="field">
        <label>Amount (USD)</label>
        <div className="input-wrap">
          <span className="input-prefix">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError('')
            }}
          />
        </div>
      </div>

      {type === 'LIMIT' && (
        <div className="field">
          <label>Limit price</label>
          <div className="input-wrap">
            <span className="input-prefix">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value)
                setError('')
              }}
            />
          </div>
        </div>
      )}

      <div className="pct-row">
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <button key={p} className="pct-btn" onClick={() => setPct(p)}>
            {p === 1 ? 'Max' : `${p * 100}%`}
          </button>
        ))}
      </div>

      <div className="ticket-meta">
        <div>
          <span>Est. units</span>
          <span className="mono">{qty > 0 ? fmtQty(qty) : '—'}</span>
        </div>
        <div>
          <span>Fee (0.1%)</span>
          <span className="mono">{fmtMoney(fee)}</span>
        </div>
        <div>
          <span>{side === 'BUY' ? 'Order total' : 'Net proceeds'}</span>
          <span className="mono">{fmtMoney(total)}</span>
        </div>
      </div>

      {error && <div className="ticket-error">{error}</div>}

      <button
        className={`submit-btn ${side === 'BUY' ? 'buy' : 'sell'}`}
        disabled={disabled}
        onClick={submit}
      >
        {type === 'LIMIT' ? 'Place ' : ''}
        {side === 'BUY' ? 'Buy' : 'Sell'} {symbol}
      </button>

      <div className="ticket-foot">
        <div>
          <span>Buying power</span>
          <span className="mono">{fmtMoney(valuation.buyingPower)}</span>
        </div>
        <div>
          <span>Position</span>
          <span className="mono">
            {posQty > 0 ? `${fmtQty(posQty)} (${fmtMoney(posValue)})` : 'None'}
          </span>
        </div>
        {posQty > 0 && (
          <div>
            <span>Avg cost</span>
            <span className="mono">${fmtPrice(avgCost(pos))}</span>
          </div>
        )}
        {posAvail !== posQty && (
          <div>
            <span>Available</span>
            <span className="mono">{fmtQty(posAvail)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
