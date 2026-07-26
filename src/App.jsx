import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sparkline from './Sparkline.jsx'
import { loadCollection, saveCollection } from './storage.js'
import { tickAll, marketParams } from './market.js'
import { searchCards, fetchPrices } from './api.js'

const TICK_MS = 2500
const SYNC_MS = 10 * 60 * 1000 // re-pull real prices every 10 minutes

const money = (n) =>
  n == null
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function timeAgo(ts) {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

export default function App() {
  const [cards, setCards] = useState(loadCollection)
  const [live, setLive] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  // Live real-world price sync: 'idle' | 'syncing' | 'ok' | 'error'
  const [syncState, setSyncState] = useState('idle')
  const [lastSync, setLastSync] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const timer = useRef(null)
  const cardsRef = useRef(cards)
  const fileInput = useRef(null)

  // Persist whenever the collection changes, and keep a live ref for the
  // sync loop (which needs the current ids without waiting on a re-render).
  useEffect(() => {
    cardsRef.current = cards
    saveCollection(cards)
  }, [cards])

  // The market loop (intra-sync simulated motion around the real base price).
  useEffect(() => {
    if (!live) return
    timer.current = setInterval(() => {
      setCards((prev) => tickAll(prev))
    }, TICK_MS)
    return () => clearInterval(timer.current)
  }, [live])

  // Pull real market prices for catalog-backed cards, re-anchoring their base
  // price to live data. The simulated ticker then reverts toward the new value.
  const refreshLivePrices = useCallback(async () => {
    const ids = cardsRef.current
      .filter((c) => c.catalogId)
      .map((c) => c.catalogId)
    if (ids.length === 0) return
    setSyncState('syncing')
    try {
      const prices = await fetchPrices(ids)
      const now = Date.now()
      setCards((prev) =>
        prev.map((c) => {
          const real = c.catalogId ? prices[c.catalogId] : undefined
          if (real == null) return c
          return { ...c, basePrice: real, realPrice: real, realPriceAt: now }
        }),
      )
      setLastSync(now)
      setSyncState('ok')
    } catch {
      setSyncState('error')
    }
  }, [])

  // Sync on mount and on a fixed interval.
  useEffect(() => {
    refreshLivePrices()
    const id = setInterval(refreshLivePrices, SYNC_MS)
    return () => clearInterval(id)
  }, [refreshLivePrices])

  function addCard(card) {
    const base = card.marketPrice || card.basePrice || 1
    const isLive = Boolean(card.id && card.marketPrice != null)
    setCards((prev) => [
      {
        id: uid(),
        catalogId: card.id || null,
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
        realPrice: isLive ? base : null,
        realPriceAt: isLive ? Date.now() : null,
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

  function download(filename, text, type) {
    const blob = new Blob([text], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const stamp = () => new Date().toISOString().slice(0, 10)

  function exportJSON() {
    setShowMenu(false)
    download(
      `pokestock-collection-${stamp()}.json`,
      JSON.stringify(cards, null, 2),
      'application/json',
    )
  }

  function exportCSV() {
    setShowMenu(false)
    const cols = ['name', 'set', 'number', 'rarity', 'quantity', 'buyPrice', 'price', 'basePrice', 'source']
    const esc = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = cards.map((c) =>
      cols
        .map((k) =>
          k === 'source'
            ? c.catalogId ? 'LIVE' : 'SIM'
            : k === 'price' || k === 'buyPrice' || k === 'basePrice'
            ? esc(Number(c[k]).toFixed(2))
            : esc(c[k]),
        )
        .join(','),
    )
    download(`pokestock-collection-${stamp()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv')
  }

  function importJSON(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file later
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!Array.isArray(parsed)) throw new Error('not an array')
        // Re-hydrate defensively so a partial/older export still runs.
        const restored = parsed
          .filter((c) => c && typeof c.name === 'string')
          .map((c) => {
            const base = Number(c.basePrice ?? c.price ?? 1) || 1
            const price = Number(c.price ?? base) || base
            return {
              ...marketParams(),
              ...c,
              id: c.id || uid(),
              quantity: Math.max(1, Number(c.quantity) || 1),
              buyPrice: Number(c.buyPrice ?? base) || base,
              basePrice: base,
              price,
              prevPrice: Number(c.prevPrice ?? price) || price,
              openPrice: Number(c.openPrice ?? price) || price,
              history: Array.isArray(c.history) && c.history.length ? c.history : [price],
            }
          })
        if (restored.length === 0) throw new Error('no valid cards')
        const replace =
          cards.length === 0 ||
          window.confirm(
            `Import ${restored.length} card(s)? This replaces your current collection of ${cards.length}.`,
          )
        if (replace) setCards(restored)
      } catch {
        window.alert('That file could not be imported — it must be a PokéStock JSON export.')
      }
    }
    reader.readAsText(file)
    setShowMenu(false)
  }

  function clearAll() {
    setShowMenu(false)
    if (cards.length === 0) return
    if (window.confirm(`Remove all ${cards.length} card(s) from your collection? This cannot be undone.`)) {
      setCards([])
    }
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
          <SyncPill
            state={syncState}
            lastSync={lastSync}
            hasLive={cards.some((c) => c.catalogId)}
            onRefresh={refreshLivePrices}
          />
          <button
            className={`ghost live-toggle ${live ? 'on' : ''}`}
            onClick={() => setLive((v) => !v)}
            title="Pause or resume the simulated ticker"
          >
            <span className="dot" /> {live ? 'Ticker on' : 'Paused'}
          </button>
          <button className="primary" onClick={() => setShowAdd(true)}>
            + Add card
          </button>
          <div className="menu-wrap">
            <button
              className="ghost icon-btn"
              onClick={() => setShowMenu((v) => !v)}
              aria-label="More actions"
              aria-expanded={showMenu}
              title="Backup & manage"
            >
              ⋯
            </button>
            {showMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setShowMenu(false)} />
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={exportJSON} disabled={cards.length === 0}>
                    ⬇ Export JSON (backup)
                  </button>
                  <button role="menuitem" onClick={exportCSV} disabled={cards.length === 0}>
                    ⬇ Export CSV (spreadsheet)
                  </button>
                  <button role="menuitem" onClick={() => fileInput.current?.click()}>
                    ⬆ Import JSON…
                  </button>
                  <div className="menu-sep" />
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={clearAll}
                    disabled={cards.length === 0}
                  >
                    🗑 Clear all cards
                  </button>
                </div>
              </>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={importJSON}
            hidden
          />
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
        <strong>LIVE</strong> cards re-anchor to real TCGplayer / Cardmarket
        prices (via the PokémonTCG API) every 10 min; the ticker adds
        intra-sync motion around that value. <strong>SIM</strong> cards are
        manual entries with a fully simulated price.
      </footer>
    </div>
  )
}

function SyncPill({ state, lastSync, hasLive, onRefresh }) {
  const label =
    state === 'syncing'
      ? 'Syncing prices…'
      : state === 'error'
      ? 'Live sync unavailable'
      : hasLive
      ? `Live prices · ${timeAgo(lastSync)}`
      : 'No live cards yet'
  return (
    <button
      className={`ghost sync-pill state-${state}`}
      onClick={onRefresh}
      disabled={state === 'syncing'}
      title="Refresh real market prices now"
    >
      <span className="sync-icon">⟳</span> {label}
    </button>
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
      {card.catalogId ? (
        <span
          className="badge badge-live"
          title={`Real market price · updated ${timeAgo(card.realPriceAt)}`}
        >
          ● LIVE
        </span>
      ) : (
        <span className="badge badge-sim" title="Simulated price (manual entry)">
          SIM
        </span>
      )}
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

        {card.catalogId && card.realPrice != null && (
          <span className="real-note" title="Latest real market price from the catalog">
            Market {money(card.realPrice)} · {timeAgo(card.realPriceAt)}
          </span>
        )}

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
