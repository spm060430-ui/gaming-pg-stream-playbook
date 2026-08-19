// Tabbed bottom panel: open positions, working orders, and fill history.
import { useState } from 'react'
import { useAccount } from '../engine/account.jsx'
import { availableQty, avgCost } from '../engine/portfolio.js'
import { fmtMoney, fmtPct, fmtPrice, fmtQty, fmtTime } from '../utils/format.js'

export default function Blotter({ onSelect }) {
  const { state, prices, submitMarket, cancelOrder } = useAccount()
  const [tab, setTab] = useState('positions')

  const posEntries = Object.entries(state.positions)
  const tabs = [
    { id: 'positions', label: `Positions (${posEntries.length})` },
    { id: 'orders', label: `Open Orders (${state.openOrders.length})` },
    { id: 'history', label: 'History' },
  ]

  return (
    <div className="blotter card">
      <div className="blotter-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`blotter-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="blotter-body">
        {tab === 'positions' && (
          <PositionsTable
            entries={posEntries}
            prices={prices}
            onSelect={onSelect}
            onClose={(sym) => {
              const q = availableQty(state.positions[sym])
              if (q > 0) submitMarket({ symbol: sym, side: 'SELL', qty: q })
            }}
          />
        )}
        {tab === 'orders' && (
          <OrdersTable orders={state.openOrders} onCancel={cancelOrder} onSelect={onSelect} />
        )}
        {tab === 'history' && <HistoryTable orders={state.orders} />}
      </div>
    </div>
  )
}

function PositionsTable({ entries, prices, onSelect, onClose }) {
  if (entries.length === 0) return <Empty text="No open positions. Place a trade to get started." />
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Symbol</th>
          <th className="r">Units</th>
          <th className="r">Avg cost</th>
          <th className="r">Last</th>
          <th className="r">Mkt value</th>
          <th className="r">Unreal. P/L</th>
          <th className="r"></th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([sym, pos]) => {
          const last = prices[sym]?.price
          const ac = avgCost(pos)
          const value = last != null ? pos.qty * last : null
          const pl = last != null ? (last - ac) * pos.qty : null
          const plPct = ac > 0 && last != null ? ((last - ac) / ac) * 100 : null
          return (
            <tr key={sym} className="clickable" onClick={() => onSelect(sym)}>
              <td className="sym-cell">{sym}</td>
              <td className="r mono">{fmtQty(pos.qty)}</td>
              <td className="r mono">${fmtPrice(ac)}</td>
              <td className="r mono">{last != null ? `$${fmtPrice(last)}` : '—'}</td>
              <td className="r mono">{value != null ? fmtMoney(value) : '—'}</td>
              <td className={`r mono ${pl == null ? '' : pl >= 0 ? 'pos' : 'neg'}`}>
                {pl != null ? `${fmtMoney(pl, { sign: true })} (${fmtPct(plPct)})` : '—'}
              </td>
              <td className="r">
                <button
                  className="mini-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(sym)
                  }}
                >
                  Close
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function OrdersTable({ orders, onCancel, onSelect }) {
  if (orders.length === 0) return <Empty text="No working orders. Place a limit order to see it here." />
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Type</th>
          <th className="r">Units</th>
          <th className="r">Limit</th>
          <th className="r"></th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="clickable" onClick={() => onSelect(o.symbol)}>
            <td className="sym-cell">{o.symbol}</td>
            <td className={o.side === 'BUY' ? 'pos' : 'neg'}>{o.side}</td>
            <td>{o.type}</td>
            <td className="r mono">{fmtQty(o.qty)}</td>
            <td className="r mono">${fmtPrice(o.limitPrice)}</td>
            <td className="r">
              <button
                className="mini-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onCancel(o.id)
                }}
              >
                Cancel
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HistoryTable({ orders }) {
  if (orders.length === 0) return <Empty text="No trades yet." />
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>Side</th>
          <th>Type</th>
          <th className="r">Units</th>
          <th className="r">Price</th>
          <th className="r">Value</th>
          <th className="r">Realized</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="mono dim">{fmtTime(o.ts)}</td>
            <td className="sym-cell">{o.symbol}</td>
            <td className={o.side === 'BUY' ? 'pos' : 'neg'}>{o.side}</td>
            <td className="dim">{o.type}</td>
            <td className="r mono">{fmtQty(o.qty)}</td>
            <td className="r mono">${fmtPrice(o.price)}</td>
            <td className="r mono">{fmtMoney(o.value)}</td>
            <td className={`r mono ${o.side === 'SELL' ? (o.realized >= 0 ? 'pos' : 'neg') : 'dim'}`}>
              {o.side === 'SELL' ? fmtMoney(o.realized, { sign: true }) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Empty({ text }) {
  return <div className="blotter-empty">{text}</div>
}
