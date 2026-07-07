// Minimal dependency-free sparkline drawn as an inline SVG polyline.
export default function Sparkline({ data, up }) {
  const pts = (data && data.length > 1) ? data : [1, 1]
  const w = 120
  const h = 34
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1
  const step = w / (pts.length - 1)
  const coords = pts.map((v, i) => {
    const x = i * step
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const stroke = up ? 'var(--up)' : 'var(--down)'
  const areaId = `area-${up ? 'u' : 'd'}`
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        fill={`url(#${areaId})`}
        points={`0,${h} ${coords.join(' ')} ${w},${h}`}
      />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coords.join(' ')}
      />
    </svg>
  )
}
