# 🃏 PokéStock — Pokémon Card Portfolio Tracker

Input your Pokémon card stock and watch each card's value move on a **live,
fluctuating market**. Track quantities, cost basis, and real-time profit / loss
across your whole collection.

![built with Vite + React](https://img.shields.io/badge/Vite-React-6c8cff)

## Features

- **Add your stock** — search the real [PokémonTCG catalog](https://pokemontcg.io)
  to autofill card art + a real base price, or add any card manually.
- **Real live pricing** — cards added from the catalog (**LIVE**) re-anchor to
  the current real TCGplayer / Cardmarket price every 10 minutes (and on demand
  via the sync button). The simulated ticker then adds believable second-to-second
  motion *around* that true value. Manually-added cards (**SIM**) run on a fully
  simulated price. Pause/resume the ticker with the toggle.
- **Per-card cards** — live price, % change, a sparkline of recent movement, the
  quantity you own, your holding value, and P/L vs. what you paid.
- **Portfolio summary** — total value, cost basis, overall profit/loss, and card
  count, all updating in real time.
- **Persistent** — your collection is saved to the browser's `localStorage`, so
  it's still there when you come back.
- **Backup & manage** — the **⋯** menu exports your collection as JSON (a full
  backup you can re-import) or CSV (for a spreadsheet), imports a JSON backup,
  and clears the whole collection. Destructive actions ask for confirmation.

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
| `src/api.js` | PokémonTCG catalog search + live price sync by card id |
| `src/storage.js` | `localStorage` persistence |
| `src/Sparkline.jsx` | Dependency-free inline-SVG price sparkline |

### About the prices

For **LIVE** cards, the base value is the real TCGplayer / Cardmarket market
price, refreshed from the catalog every 10 minutes (TCG prices update roughly
daily, so this is real market data, not tick-by-tick trading). The
second-to-second **fluctuation** on top is a client-side simulation for a live
feel. If the catalog can't be reached, you can still add cards manually
(**SIM**) and the market runs on the price you enter.
