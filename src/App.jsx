import { useEffect, useState } from 'react'
import { AccountProvider, useAccount } from './engine/account.jsx'
import { marketFeed } from './data/marketFeed.js'
import { loadPrefs, savePrefs } from './engine/storage.js'
import Header from './components/Header.jsx'
import Watchlist from './components/Watchlist.jsx'
import PriceChart from './components/PriceChart.jsx'
import TradePanel from './components/TradePanel.jsx'
import Blotter from './components/Blotter.jsx'
import Toast from './components/Toast.jsx'

function Terminal() {
  const { prices, state } = useAccount()
  const prefs = loadPrefs()
  const [mode, setMode] = useState(prefs.mode === 'sim' ? 'sim' : 'live')
  const [selected, setSelected] = useState(prefs.selected || 'BTC')

  // Start / restart the market feed whenever the mode changes.
  useEffect(() => {
    marketFeed.start(mode)
    savePrefs({ ...loadPrefs(), mode })
  }, [mode])

  useEffect(() => {
    savePrefs({ ...loadPrefs(), selected })
  }, [selected])

  const livePrice = prices[selected]?.price ?? null

  return (
    <div className="app">
      <Header mode={mode} onToggleMode={() => setMode((m) => (m === 'sim' ? 'live' : 'sim'))} />

      <main className="layout">
        <aside className="col-left">
          <Watchlist
            prices={prices}
            positions={state.positions}
            selected={selected}
            onSelect={setSelected}
          />
        </aside>

        <section className="col-center">
          <PriceChart symbol={selected} livePrice={livePrice} />
          <Blotter onSelect={setSelected} />
        </section>

        <aside className="col-right">
          <TradePanel symbol={selected} />
        </aside>
      </main>

      <Toast />
    </div>
  )
}

export default function App() {
  return (
    <AccountProvider>
      <Terminal />
    </AccountProvider>
  )
}
