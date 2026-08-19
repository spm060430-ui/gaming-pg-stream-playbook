// Scrollable list of tradable assets with live price + 24h change.
import { useEffect, useRef, useState } from 'react'
import { ASSETS } from '../data/providers.js'
import { fmtPrice, fmtPct } from '../utils/format.js'

function Row({ asset, row, selected, held, onSelect }) {
  const price = row?.price
  const [flash, setFlash] = useState('')
  const prev = useRef(price)

  useEffect(() => {
    if (price == null || prev.current == null) {
      prev.current = price
      return
    }
    if (price > prev.current) setFlash('flash-up')
    else if (price < prev.current) setFlash('flash-down')
    prev.current = price
    const t = setTimeout(() => setFlash(''), 350)
    return () => clearTimeout(t)
  }, [price])

  const chg = row?.changePct ?? 0
  return (
    <button
      className={`wl-row ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(asset.symbol)}
    >
      <div className="wl-sym">
        <span className="wl-ticker">{asset.symbol}</span>
        <span className="wl-name">{asset.name}</span>
      </div>
      <div className="wl-right">
        <span className={`wl-price mono ${flash}`}>{price != null ? `$${fmtPrice(price)}` : '—'}</span>
        <span className={`wl-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{fmtPct(chg)}</span>
      </div>
      {held && <span className="wl-held" title="You hold this asset" />}
    </button>
  )
}

export default function Watchlist({ prices, positions, selected, onSelect }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toUpperCase()
  const list = q
    ? ASSETS.filter((a) => a.symbol.includes(q) || a.name.toUpperCase().includes(q))
    : ASSETS

  return (
    <div className="watchlist card">
      <div className="wl-head">
        <h2>Markets</h2>
        <input
          className="wl-search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="wl-body">
        {list.map((a) => (
          <Row
            key={a.symbol}
            asset={a}
            row={prices[a.symbol]}
            selected={selected === a.symbol}
            held={!!positions[a.symbol]}
            onSelect={onSelect}
          />
        ))}
        {list.length === 0 && <div className="wl-empty">No matches.</div>}
      </div>
    </div>
  )
}
