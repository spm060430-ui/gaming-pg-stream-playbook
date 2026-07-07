import { useEffect, useMemo, useRef, useState } from 'react'
import Sparkline from './Sparkline.jsx'
import { loadCollection, saveCollection } from './storage.js'
import { tickAll, marketParams } from './market.js'
import { searchCards } from './api.js'

const TICK_MS = 2500

const money = (n) =>
  n == null
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function App() {
  const [cards, setCards] = useState(loadCollection)
  const [live, setLive] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const timer = useRef(null)

  // Persist whenever the collection changes.
  useEffect(() => {
    saveCollection(cards)
  }, [cards])

  // The market loop.
  useEffect(() => {
    if (!live) return
    timer.current = setInterval(() => {
      setCards((prev) => tickAll(prev))
    }, TICK_MS)
    return () => clearInterval(timer.current)
  }, [live])

  function addCard(card) {
    const base = card.marketPrice || card.basePrice || 1
    setCards((prev) => [
      {
        id: uid(),
        name: card.name,
        set: card.set || '',
        number: card.number || '',
        rarity: card.rarity || '',
        image: card.image || '',
        quantity: card.quantity || 1,
        buyPrice: card.buyPrice ?? base,
        basePrice: base,
        price: base,
        prevPrice: base,
        openPrice: base,
        history: [base],
        ...marketParams(),
      },
      ...prev,
    ])
    setShowAdd(false)
  }

  function removeCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id))
  }

  function updateQty(id, delta) {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c,
      ),
    )
  }

  const totals = useMemo(() => {
    let value = 0
    let cost = 0
    let units = 0
    for (const c of cards) {
      value += c.price * c.quantity
      cost += c.buyPrice * c.quantity
      units += c.quantity
    }
    const pl = value - cost
    const plPct = cost > 0 ? (pl / cost) * 100 : 0
    return { value, cost, pl, plPct, units, count: cards.length }
  }, [cards])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">🃏</span>
          <div>
            <h1>PokéStock</h1>
            <p className="tagline">Live Pokémon card portfolio</p>
          </div>
        </div>
        <div className="actions">
          <button
            className={`ghost live-toggle ${live ? 'on' : ''}`}
            onClick={() => setLive((v) => !v)}
            title="Pause or resume the market"
          >
            <span className="dot" /> {live ? 'Market live' : 'Paused'}
          </button>
          <button className="primary" onClick={() => setShowAdd(true)}>
            + Add card
          </button>
        </div>
      </header>

      <section className="summary">
        <Stat label="Portfolio value" value={money(totals.value)} big />
        <Stat label="Cost basis" value={money(totals.cost)} />
        <Stat
          label="Profit / Loss"
          value={money(totals.pl)}
          sub={pct(totals.plPct)}
          tone={totals.pl >= 0 ? 'up' : 'down'}
        />
        <Stat label="Cards" value={`${totals.count}`} sub={`${totals.units} units`} />
      </section>

      {cards.length === 0 ? (
        <Empty onAdd={() => setShowAdd(true)} />
      ) : (
        <main className="grid">
          {cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              onRemove={() => removeCard(c.id)}
              onQty={(d) => updateQty(c.id, d)}
            />
          ))}
        </main>
      )}

      {showAdd && <AddCardModal onAdd={addCard} onClose={() => setShowAdd(false)} />}

      <footer className="foot">
        Prices are simulated for tracking &amp; entertainment. Base prices, when
        available, come from the public PokémonTCG API.
      </footer>
    </div>
  )
}

function Stat({ label, value, sub, tone, big }) {
  return (
    <div className={`stat ${big ? 'stat-big' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</span>
      {sub && <span className={`stat-sub ${tone ? `tone-${tone}` : ''}`}>{sub}</span>}
    </div>
  )
}

function CardTile({ card, onRemove, onQty }) {
  const up = card.price >= (card.prevPrice ?? card.price)
  const dayChange = ((card.price - card.openPrice) / card.openPrice) * 100
  const holdingValue = card.price * card.quantity
  const costBasis = card.buyPrice * card.quantity
  const pl = holdingValue - costBasis
  const plPct = costBasis > 0 ? (pl / costBasis) * 100 : 0

  return (
    <article className={`card ${up ? 'is-up' : 'is-down'}`}>
      <button className="remove" onClick={onRemove} title="Remove card">
        ✕
      </button>
      <div className="card-media">
        {card.image ? (
          <img src={card.image} alt={card.name} loading="lazy" />
        ) : (
          <div className="noimg">🃏</div>
        )}
      </div>
      <div className="card-body">
        <div className="card-head">
          <h3 title={card.name}>{card.name}</h3>
          <span className="setline">
            {card.set}
            {card.number ? ` · #${card.number}` : ''}
            {card.rarity ? ` · ${card.rarity}` : ''}
          </span>
        </div>

        <div className="price-row">
          <span className="price">{money(card.price)}</span>
          <span className={`change ${up ? 'tone-up' : 'tone-down'}`}>
            {up ? '▲' : '▼'} {pct(dayChange)}
          </span>
        </div>

        <Sparkline data={card.history} up={up} />

        <div className="qty">
          <button onClick={() => onQty(-1)} aria-label="Decrease quantity">
            −
          </button>
          <span>
            <strong>{card.quantity}</strong> owned
          </span>
          <button onClick={() => onQty(1)} aria-label="Increase quantity">
            +
          </button>
        </div>

        <div className="holding">
          <div>
            <span className="mini-label">Holding</span>
            <span className="mini-val">{money(holdingValue)}</span>
          </div>
          <div className="ta-right">
            <span className="mini-label">P / L</span>
            <span className={`mini-val ${pl >= 0 ? 'tone-up' : 'tone-down'}`}>
              {money(pl)} ({pct(plPct)})
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

function Empty({ onAdd }) {
  return (
    <div className="empty">
      <div className="empty-emoji">🎴</div>
      <h2>Your binder is empty</h2>
      <p>Add your first card to start tracking its market value.</p>
      <button className="primary" onClick={onAdd}>
        + Add your first card
      </button>
    </div>
  )
}

function AddCardModal({ onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [selected, setSelected] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [buyPrice, setBuyPrice] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const debounce = useRef(null)

  useEffect(() => {
    clearTimeout(debounce.current)
    if (query.trim().length < 2) {
      setResults([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    debounce.current = setTimeout(async () => {
      try {
        const r = await searchCards(query)
        setResults(r)
        setStatus('done')
      } catch {
        setStatus('error')
        setResults([])
      }
    }, 350)
    return () => clearTimeout(debounce.current)
  }, [query])

  function confirmSearch() {
    if (!selected) return
    onAdd({
      ...selected,
      quantity: Number(quantity) || 1,
      buyPrice: buyPrice === '' ? selected.marketPrice : Number(buyPrice),
    })
  }

  function confirmManual() {
    if (!manualName.trim()) return
    const base = Number(manualPrice) || 1
    onAdd({
      name: manualName.trim(),
      basePrice: base,
      marketPrice: base,
      quantity: Number(quantity) || 1,
      buyPrice: buyPrice === '' ? base : Number(buyPrice),
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add a card</h2>
          <button className="remove" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span>Search the PokémonTCG catalog</span>
          <input
            autoFocus
            placeholder="e.g. Charizard, Pikachu, Umbreon…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
          />
        </label>

        {status === 'loading' && <p className="hint">Searching…</p>}
        {status === 'error' && (
          <p className="hint warn">
            Couldn’t reach the catalog. You can still add the card manually below.
          </p>
        )}

        {results.length > 0 && (
          <div className="results">
            {results.map((r) => (
              <button
                key={r.id}
                className={`result ${selected?.id === r.id ? 'sel' : ''}`}
                onClick={() => {
                  setSelected(r)
                  setBuyPrice(r.marketPrice != null ? String(r.marketPrice) : '')
                }}
              >
                {r.image ? (
                  <img src={r.image} alt="" loading="lazy" />
                ) : (
                  <div className="noimg sm">🃏</div>
                )}
                <span className="r-name">{r.name}</span>
                <span className="r-set">{r.set}</span>
                <span className="r-price">{money(r.marketPrice)}</span>
              </button>
            ))}
          </div>
        )}

        {(
          <div className="add-controls">
            {!selected && (
              <label className="field">
                <span>Or add manually — card name</span>
                <input
                  placeholder="Card name"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
              </label>
            )}
            <div className="row">
              {!selected && (
                <label className="field">
                  <span>Market price (USD)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Your buy price (ea.)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={onClose}>
                Cancel
              </button>
              {selected ? (
                <button className="primary" onClick={confirmSearch}>
                  Add {selected.name}
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={confirmManual}
                  disabled={!manualName.trim()}
                >
                  Add card
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
