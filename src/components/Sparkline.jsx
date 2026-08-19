// Tiny inline sparkline from a series of numbers.
export default function Sparkline({ values, width = 96, height = 28, up }) {
  if (!values || values.length < 2) {
    return <svg width={width} height={height} className="spark" />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const rising = up != null ? up : values[values.length - 1] >= values[0]
  const color = rising ? 'var(--up)' : 'var(--down)'
  return (
    <svg width={width} height={height} className="spark" preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}
