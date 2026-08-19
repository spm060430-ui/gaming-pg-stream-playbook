// Candlestick price chart drawn as scalable SVG. Loads historical candles
// from the active provider and folds the live tick into the last candle.
import { useEffect, useMemo, useRef, useState } from 'react'
import { marketFeed } from '../data/marketFeed.js'
import { INTERVALS, NAME_BY_SYMBOL } from '../data/providers.js'
import { fmtPrice, fmtTime } from '../utils/format.js'

const W = 820
const H = 380
const PAD = { top: 16, right: 66, bottom: 24, left: 8 }

export default function PriceChart({ symbol, livePrice }) {
  const [interval, setInterval] = useState('1m')
  const [candles, setCandles] = useState([])
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [hover, setHover] = useState(null)
  const reqId = useRef(0)

  useEffect(() => {
    const id = ++reqId.current
    setStatus('loading')
    marketFeed
      .getCandles(symbol, { interval, limit: 120 })
      .then((rows) => {
        if (id !== reqId.current) return
        setCandles(rows)
        setStatus(rows.length ? 'ok' : 'error')
      })
      .catch(() => {
        if (id !== reqId.current) return
        setStatus('error')
      })
  }, [symbol, interval])

  // Fold the live price into the final candle so the chart breathes.
  const data = useMemo(() => {
    if (!candles.length) return candles
    if (livePrice == null) return candles
    const copy = candles.slice()
    const last = { ...copy[copy.length - 1] }
    last.c = livePrice
    last.h = Math.max(last.h, livePrice)
    last.l = Math.min(last.l, livePrice)
    copy[copy.length - 1] = last
    return copy
  }, [candles, livePrice])

  const geom = useMemo(() => computeGeom(data), [data])

  return (
    <div className="chart card">
      <div className="chart-head">
        <div className="chart-title">
          <span className="chart-symbol">{symbol}</span>
          <span className="chart-name">{NAME_BY_SYMBOL[symbol]}</span>
          <span className="chart-price mono">${fmtPrice(livePrice ?? geom?.lastClose)}</span>
        </div>
        <div className="chart-intervals">
          {INTERVALS.map((iv) => (
            <button
              key={iv.id}
              className={`iv-btn ${interval === iv.id ? 'active' : ''}`}
              onClick={() => setInterval(iv.id)}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-body">
        {status === 'loading' && <div className="chart-msg">Loading chart…</div>}
        {status === 'error' && <div className="chart-msg">Chart data unavailable.</div>}
        {status === 'ok' && geom && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="chart-svg"
            preserveAspectRatio="none"
            onMouseMove={(e) => setHover(hitTest(e, geom, data))}
            onMouseLeave={() => setHover(null)}
          >
            {geom.yTicks.map((t) => (
              <g key={t.price}>
                <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} className="grid" />
                <text x={W - PAD.right + 6} y={t.y + 3} className="axis-label">
                  {fmtPrice(t.price)}
                </text>
              </g>
            ))}

            {geom.candles.map((c, i) => (
              <g key={i} className={c.up ? 'c-up' : 'c-down'}>
                <line x1={c.x} x2={c.x} y1={c.hy} y2={c.ly} className="wick" />
                <rect x={c.x - geom.bw / 2} y={c.by} width={geom.bw} height={Math.max(1, c.bh)} className="body" />
              </g>
            ))}

            {livePrice != null && (
              <g>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={geom.priceToY(livePrice)}
                  y2={geom.priceToY(livePrice)}
                  className="live-line"
                />
                <rect x={W - PAD.right} y={geom.priceToY(livePrice) - 9} width={PAD.right} height={18} className="live-tag-bg" />
                <text x={W - PAD.right + 6} y={geom.priceToY(livePrice) + 3} className="live-tag">
                  {fmtPrice(livePrice)}
                </text>
              </g>
            )}

            {hover && (
              <g>
                <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={H - PAD.bottom} className="crosshair" />
              </g>
            )}
          </svg>
        )}

        {hover && (
          <div className="chart-tip">
            <span>{fmtTime(hover.c.t)}</span>
            <span>O {fmtPrice(hover.c.o)}</span>
            <span>H {fmtPrice(hover.c.h)}</span>
            <span>L {fmtPrice(hover.c.l)}</span>
            <span>C {fmtPrice(hover.c.c)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function computeGeom(data) {
  if (!data || data.length < 2) return null
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  let hi = -Infinity
  let lo = Infinity
  for (const c of data) {
    if (c.h > hi) hi = c.h
    if (c.l < lo) lo = c.l
  }
  const pad = (hi - lo) * 0.08 || hi * 0.01 || 1
  hi += pad
  lo -= pad
  const range = hi - lo || 1
  const priceToY = (p) => PAD.top + innerH - ((p - lo) / range) * innerH
  const step = innerW / data.length
  const bw = Math.max(1.5, step * 0.62)

  const candles = data.map((c, i) => {
    const x = PAD.left + step * (i + 0.5)
    const up = c.c >= c.o
    const yo = priceToY(c.o)
    const yc = priceToY(c.c)
    return {
      x,
      up,
      hy: priceToY(c.h),
      ly: priceToY(c.l),
      by: Math.min(yo, yc),
      bh: Math.abs(yc - yo),
    }
  })

  const ticks = 5
  const yTicks = []
  for (let i = 0; i <= ticks; i++) {
    const price = lo + (range * i) / ticks
    yTicks.push({ price, y: priceToY(price) })
  }

  return { candles, priceToY, yTicks, bw, step, lastClose: data[data.length - 1].c }
}

function hitTest(e, geom, data) {
  const svg = e.currentTarget
  const rect = svg.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * W
  const i = Math.min(data.length - 1, Math.max(0, Math.round((x - PAD.left) / geom.step - 0.5)))
  const cx = PAD.left + geom.step * (i + 0.5)
  return { x: cx, c: data[i] }
}
