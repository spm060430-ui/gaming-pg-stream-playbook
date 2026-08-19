// Top bar: brand, live equity/P&L stats, connection status, and controls.
import { useAccount } from '../engine/account.jsx'
import { fmtMoney, fmtPct } from '../utils/format.js'

function Stat({ label, value, cls }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value mono ${cls || ''}`}>{value}</span>
    </div>
  )
}

function StatusPill({ status, providerLabel }) {
  const map = {
    connecting: { text: 'Connecting…', cls: 'warn' },
    live: { text: `${providerLabel || 'Live'} · LIVE`, cls: 'live' },
    reconnecting: { text: 'Reconnecting…', cls: 'warn' },
    offline: { text: 'Feed offline', cls: 'off' },
    sim: { text: 'DEMO · simulated', cls: 'sim' },
    idle: { text: 'Starting…', cls: 'warn' },
  }
  const s = map[status] || map.idle
  return (
    <span className={`pill ${s.cls}`}>
      <span className="pill-dot" />
      {s.text}
    </span>
  )
}

export default function Header({ mode, onToggleMode }) {
  const { valuation, feed, resetAccount, liquidateAll } = useAccount()
  const plCls = valuation.totalPL >= 0 ? 'pos' : 'neg'

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">📈</span>
        <div className="brand-text">
          <span className="brand-name">DayTrader</span>
          <span className="brand-sub">paper-trading simulator</span>
        </div>
      </div>

      <div className="stats">
        <Stat label="Equity" value={fmtMoney(valuation.equity)} />
        <Stat
          label="Total P/L"
          value={`${fmtMoney(valuation.totalPL, { sign: true })} (${fmtPct(valuation.totalPLPct)})`}
          cls={plCls}
        />
        <Stat label="Buying power" value={fmtMoney(valuation.buyingPower)} />
        <Stat
          label="Unrealized"
          value={fmtMoney(valuation.unrealized, { sign: true })}
          cls={valuation.unrealized >= 0 ? 'pos' : 'neg'}
        />
        <Stat
          label="Realized"
          value={fmtMoney(valuation.realized, { sign: true })}
          cls={valuation.realized >= 0 ? 'pos' : 'neg'}
        />
      </div>

      <div className="topbar-right">
        <StatusPill status={feed.status} providerLabel={feed.providerLabel} />
        <button
          className="ghost-btn"
          title="Toggle between live prices and an offline simulated demo"
          onClick={onToggleMode}
        >
          {mode === 'sim' ? 'Go Live' : 'Demo mode'}
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            if (confirm('Market-sell every open position at the current price?')) liquidateAll()
          }}
        >
          Liquidate
        </button>
        <button
          className="ghost-btn danger"
          onClick={() => {
            if (confirm('Reset the account to $100,000 and erase all history?')) resetAccount()
          }}
        >
          Reset
        </button>
      </div>
    </header>
  )
}
