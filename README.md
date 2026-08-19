# 📈 DayTrader — Live Paper-Trading Simulator

Become the ultimate day trader — **risk-free**. Start with **$100,000 in virtual
cash** and trade a live, real-time crypto market. Every price is a **real quote**
pulled from a public exchange; only the money is fake.

![built with Vite + React](https://img.shields.io/badge/Vite-React-6c8cff)

## Why crypto?

Crypto is the only market with a **keyless, always-on, real-time** public feed —
no API key, no signup, and it trades **24/7**, so the simulator is always live
(stock feeds need paid keys and only move during market hours).

## Features

- **Real live prices** — quotes stream from **Binance**, automatically falling
  back to **Coinbase** if Binance is unreachable (e.g. region-blocked). A slow
  REST poll keeps 24h stats fresh while a **WebSocket** layers on second-by-second
  ticks.
- **Candlestick charts** — real historical candles (1m / 5m / 15m / 1H) with a
  live price line, folded live tick, and a hover crosshair showing OHLC.
- **Market & limit orders** — buy or sell by USD notional with quick 25/50/75/Max
  sizing. Working **limit orders** fill automatically when the live price crosses
  your level.
- **Full P/L accounting** — average cost basis, realized vs. unrealized P/L, a
  0.1% taker fee on both sides, live account equity, and total return.
- **Blotter** — open positions (with one-click close), working orders (with
  cancel), and a full fill history.
- **Persistent** — your account, positions, and history are saved to
  `localStorage`, so everything is still there when you come back.
- **Demo mode** — no live feed reachable (or just want to experiment offline)?
  Flip to a clearly-labelled **simulated** market that runs entirely in-browser.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

```bash
npm run build     # production build to dist/
npm run preview   # preview the production build
```

## How it works

```
src/
  data/
    providers.js    Binance / Coinbase / simulated adapters (quotes, candles, WS)
    marketFeed.js   provider auto-detect, polling + WS, subscribable snapshot
  engine/
    portfolio.js    pure trading logic: orders, avg cost, realized/unrealized P/L
    storage.js      localStorage persistence
    account.jsx     React context tying the engine to the live feed
  components/       Header, Watchlist, PriceChart, TradePanel, Blotter, Toast
  utils/format.js   money / price / percent formatting
```

The trading engine (`engine/portfolio.js`) is pure and side-effect free — every
action takes the account state and returns the next state — which keeps the P/L
math easy to reason about and test.

## Notes & disclaimer

This is a **paper-trading simulator for education and fun**. It places no real
orders and moves no real money. Prices come from public exchange endpoints and
may be rate-limited, delayed, or unavailable in some regions — the app degrades
gracefully (Coinbase fallback, then demo mode) when that happens. Nothing here is
financial advice.
