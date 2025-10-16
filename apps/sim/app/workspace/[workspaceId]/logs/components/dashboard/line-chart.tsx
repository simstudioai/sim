import { useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'

export interface LineChartPoint {
  timestamp: string
  value: number
}

export function LineChart({
  data,
  label,
  color,
  unit,
}: {
  data: LineChartPoint[]
  label: string
  color: string
  unit?: string
}) {
  // Responsive sizing: chart fills its container width
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(420)
  const width = containerWidth
  const height = 166
  // Slightly more right padding to keep the last point clear of the edge
  const padding = { top: 16, right: 28, bottom: 26, left: 26 }
  // Observe container width for responsiveness
  useEffect(() => {
    if (!containerRef.current) return
    const element = containerRef.current
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry?.contentRect) {
        const w = Math.max(280, Math.floor(entry.contentRect.width))
        setContainerWidth(w)
      }
    })
    ro.observe(element)
    // Initialize once immediately
    const rect = element.getBoundingClientRect()
    if (rect?.width) setContainerWidth(Math.max(280, Math.floor(rect.width)))
    return () => ro.disconnect()
  }, [])
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isDark, setIsDark] = useState<boolean>(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const el = document.documentElement
    const update = () => setIsDark(el.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  if (data.length === 0) {
    return (
      <div
        className='flex items-center justify-center rounded-lg border bg-card p-4'
        style={{ width, height }}
      >
        <p className='text-muted-foreground text-sm'>No data</p>
      </div>
    )
  }

  // Ensure nice padding on the y-domain so the line never hugs the axes
  const rawMax = Math.max(...data.map((d) => d.value), 1)
  const rawMin = Math.min(...data.map((d) => d.value), 0)
  const paddedMax = rawMax === 0 ? 1 : rawMax * 1.1
  const paddedMin = Math.min(0, rawMin) // never below zero for our metrics
  const unitSuffixPre = (unit || '').trim().toLowerCase()
  let maxValue = Math.ceil(paddedMax)
  let minValue = Math.floor(paddedMin)
  // For time charts (ms), round to the nearest thousand for cleaner ticks
  if (unitSuffixPre === 'ms') {
    maxValue = Math.max(1000, Math.ceil(paddedMax / 1000) * 1000)
    minValue = 0
  }
  const valueRange = maxValue - minValue || 1

  const yMin = padding.top + 3
  const yMax = padding.top + chartHeight - 3

  const scaledPoints = data.map((d, i) => {
    const usableW = Math.max(1, chartWidth - 8) // small buffer at right to avoid clipping and leave padding
    const x = padding.left + (i / (data.length - 1 || 1)) * usableW
    const rawY = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
    // keep the line safely within the plotting area to avoid clipping behind the x-axis
    const y = Math.max(yMin, Math.min(yMax, rawY))
    return { x, y }
  })

  const pathD = (() => {
    if (scaledPoints.length <= 1) return ''
    const p = scaledPoints
    const tension = 0.2
    let d = `M ${p[0].x} ${p[0].y}`
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i]
      const p1 = p[i]
      const p2 = p[i + 1]
      const p3 = p[i + 2] || p[i + 1]
      const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension
      let cp1y = p1.y + ((p2.y - p0.y) / 6) * tension
      const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension
      let cp2y = p2.y - ((p3.y - p1.y) / 6) * tension
      // Clamp control points vertically to avoid bezier overshoot below the axis
      cp1y = Math.max(yMin, Math.min(yMax, cp1y))
      cp2y = Math.max(yMin, Math.min(yMax, cp2y))
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    return d
  })()

  return (
    <div
      ref={containerRef}
      className='w-full overflow-hidden rounded-[11px] border bg-card p-4 shadow-sm'
    >
      <h4 className='mb-3 font-medium text-foreground text-sm'>{label}</h4>
      <TooltipProvider delayDuration={0}>
        <div className='relative' style={{ width, height }}>
          <svg
            width={width}
            height={height}
            className='overflow-hidden'
            onMouseMove={(e) => {
              if (scaledPoints.length === 0) return
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const x = e.clientX - rect.left
              const clamped = Math.max(padding.left, Math.min(width - padding.right, x))
              const ratio = (clamped - padding.left) / (chartWidth || 1)
              const i = Math.round(ratio * (scaledPoints.length - 1))
              setHoverIndex(i)
            }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={`area-${label.replace(/\s+/g, '-')}`} x1='0' x2='0' y1='0' y2='1'>
                <stop offset='0%' stopColor={color} stopOpacity={isDark ? 0.25 : 0.45} />
                <stop offset='100%' stopColor={color} stopOpacity={isDark ? 0.03 : 0.08} />
              </linearGradient>
              <clipPath id={`clip-${label.replace(/\s+/g, '-')}`}>
                <rect
                  x={padding.left}
                  y={yMin}
                  width={Math.max(1, chartWidth - 8)}
                  height={chartHeight - (yMin - padding.top) * 2}
                  rx='2'
                />
              </clipPath>
            </defs>

            <line
              x1={padding.left}
              y1={padding.top}
              x2={padding.left}
              y2={height - padding.bottom}
              stroke='hsl(var(--border))'
              strokeWidth='1'
            />

            {[0.25, 0.5, 0.75].map((p) => (
              <line
                key={`${label}-grid-${p}`}
                x1={padding.left}
                y1={padding.top + chartHeight * p}
                x2={width - padding.right}
                y2={padding.top + chartHeight * p}
                stroke='hsl(var(--muted))'
                strokeOpacity='0.35'
                strokeWidth='1'
              />
            ))}

            {/* axis baseline is drawn last (after line) to visually mask any overshoot */}

            {scaledPoints.length > 1 && (
              <path
                d={`${pathD} L ${scaledPoints[scaledPoints.length - 1].x} ${height - padding.bottom} L ${scaledPoints[0].x} ${height - padding.bottom} Z`}
                fill={`url(#area-${label.replace(/\s+/g, '-')})`}
                stroke='none'
                clipPath={`url(#clip-${label.replace(/\s+/g, '-')})`}
              />
            )}

            {scaledPoints.length > 1 ? (
              <path
                d={pathD}
                fill='none'
                stroke={color}
                strokeWidth={isDark ? 1.75 : 2.25}
                strokeLinecap='round'
                clipPath={`url(#clip-${label.replace(/\s+/g, '-')})`}
                style={{ mixBlendMode: isDark ? 'screen' : 'normal' }}
              />
            ) : (
              // Single-point series: show a dot so the value doesn't "disappear"
              <circle cx={scaledPoints[0].x} cy={scaledPoints[0].y} r='3' fill={color} />
            )}

            {hoverIndex !== null && scaledPoints[hoverIndex] && scaledPoints.length > 1 && (
              <g pointerEvents='none' clipPath={`url(#clip-${label.replace(/\s+/g, '-')})`}>
                <line
                  x1={scaledPoints[hoverIndex].x}
                  y1={padding.top}
                  x2={scaledPoints[hoverIndex].x}
                  y2={height - padding.bottom}
                  stroke={color}
                  strokeOpacity='0.35'
                  strokeDasharray='3 3'
                />
                <circle
                  cx={scaledPoints[hoverIndex].x}
                  cy={scaledPoints[hoverIndex].y}
                  r='3'
                  fill={color}
                />
              </g>
            )}

            {(() => {
              if (data.length < 2) return null
              const usableW = Math.max(1, chartWidth - 8)
              const idx = [0, Math.floor(data.length / 2), data.length - 1]
              return idx.map((i) => {
                const x = padding.left + (i / (data.length - 1 || 1)) * usableW
                const tsSource = data[i]?.timestamp
                if (!tsSource) return null
                const ts = new Date(tsSource)
                const labelStr = Number.isNaN(ts.getTime())
                  ? ''
                  : ts.toLocaleString('en-US', { month: 'short', day: 'numeric' })
                return (
                  <text
                    key={`${label}-x-axis-${i}`}
                    x={x}
                    y={height - padding.bottom + 14}
                    fontSize='9'
                    textAnchor='middle'
                    fill='hsl(var(--muted-foreground))'
                  >
                    {labelStr}
                  </text>
                )
              })
            })()}

            {(() => {
              // If unit is a noun like "execs", don't duplicate it per tick; show once as axis label
              const unitSuffix = (unit || '').trim()
              // Only keep '%' in y-ticks; remove 'ms' and any other nouns (shown on hover instead)
              const showInTicks = unitSuffix === '%'
              const fmtCompact = (v: number) =>
                new Intl.NumberFormat('en-US', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                })
                  .format(v)
                  .toLowerCase()
              return (
                <>
                  <text
                    x={padding.left - 8}
                    y={padding.top}
                    textAnchor='end'
                    fontSize='9'
                    fill='hsl(var(--muted-foreground))'
                  >
                    {fmtCompact(maxValue)}
                    {showInTicks ? unit : ''}
                  </text>
                  <text
                    x={padding.left - 8}
                    y={height - padding.bottom}
                    textAnchor='end'
                    fontSize='9'
                    fill='hsl(var(--muted-foreground))'
                  >
                    {fmtCompact(minValue)}
                    {showInTicks ? unit : ''}
                  </text>
                </>
              )
            })()}

            <line
              x1={padding.left}
              y1={height - padding.bottom}
              x2={width - padding.right}
              y2={height - padding.bottom}
              stroke='hsl(var(--border))'
              strokeWidth='1'
            />
          </svg>

          {hoverIndex !== null &&
            scaledPoints[hoverIndex] &&
            (() => {
              const pt = scaledPoints[hoverIndex]
              const val = data[hoverIndex]?.value
              let formatted = ''
              if (typeof val === 'number' && Number.isFinite(val)) {
                const u = unit || ''
                if (u.includes('%')) {
                  formatted = `${val.toFixed(1)}%`
                } else if (u.toLowerCase().includes('ms')) {
                  formatted = `${Math.round(val)}ms`
                } else if (u.toLowerCase().includes('exec')) {
                  formatted = `${Math.round(val)}${u}` // keep label like " execs"
                } else {
                  formatted = `${Math.round(val)}${u}`
                }
              }
              const left = Math.min(Math.max(pt.x + 8, padding.left), width - padding.right - 60)
              const top = Math.min(Math.max(pt.y - 26, padding.top), height - padding.bottom - 18)
              return (
                <div
                  className='pointer-events-none absolute rounded-md bg-background/80 px-2 py-1 font-medium text-[11px] shadow-sm ring-1 ring-border backdrop-blur'
                  style={{ left, top }}
                >
                  {formatted}
                </div>
              )
            })()}
        </div>
      </TooltipProvider>
    </div>
  )
}

export default LineChart
