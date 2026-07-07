# 🃏 PokéStock — Pokémon Card Portfolio Tracker

Input your Pokémon card stock and watch each card's value move on a **live,
fluctuating market**. Track quantities, cost basis, and real-time profit / loss
across your whole collection.

![built with Vite + React](https://img.shields.io/badge/Vite-React-6c8cff)

## Features

- **Add your stock** — search the real [PokémonTCG catalog](https://pokemontcg.io)
  to autofill card art + a real base price, or add any card manually.
- **Live market** — every card's price follows a simulated random walk with mild
  mean-reversion, so values fluctuate believably second-to-second. Pause/resume
  anytime with the **Market live** toggle.
- **Per-card cards** — live price, % change, a sparkline of recent movement, the
  quantity you own, your holding value, and P/L vs. what you paid.
- **Portfolio summary** — total value, cost basis, overall profit/loss, and card
  count, all updating in real time.
- **Persistent** — your collection is saved to the browser's `localStorage`, so
  it's still there when you come back.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

To build a static production bundle:

```bash
npm run build   # outputs to dist/
npm run preview # serve the built bundle
```

## How it works

| File | Purpose |
|------|---------|
| `src/App.jsx` | UI: portfolio summary, card grid, add-card modal |
| `src/market.js` | The simulated market engine (random walk + mean-reversion) |
| `src/api.js` | Optional PokémonTCG catalog search (images + base prices) |
| `src/storage.js` | `localStorage` persistence |
| `src/Sparkline.jsx` | Dependency-free inline-SVG price sparkline |

### About the prices

Base prices, when a card is found in the catalog, come from real TCGplayer /
Cardmarket data. The **fluctuation** is a client-side simulation for tracking and
entertainment — it is not live trading data. If the catalog can't be reached,
you can still add cards manually and the market runs on the price you enter.
