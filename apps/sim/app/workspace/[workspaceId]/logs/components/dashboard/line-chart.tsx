import { useEffect, useRef, useState } from 'react'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'

export interface LineChartPoint {
  timestamp: string
  value: number
}

export interface LineChartMultiSeries {
  id?: string
  label: string
  color: string
  data: LineChartPoint[]
  dashed?: boolean
}

export function LineChart({
  data,
  label,
  color,
  unit,
  series,
}: {
  data: LineChartPoint[]
  label: string
  color: string
  unit?: string
  series?: LineChartMultiSeries[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(420)
  const width = containerWidth
  const height = 166
  const padding = { top: 16, right: 28, bottom: 26, left: 26 }
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
    const rect = element.getBoundingClientRect()
    if (rect?.width) setContainerWidth(Math.max(280, Math.floor(rect.width)))
    return () => ro.disconnect()
  }, [])
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isDark, setIsDark] = useState<boolean>(true)
  const [hoverSeriesId, setHoverSeriesId] = useState<string | null>(null)
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)

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

  const allSeries = (
    Array.isArray(series) && series.length > 0
      ? [{ id: 'base', label, color, data }, ...series]
      : [{ id: 'base', label, color, data }]
  ).map((s, idx) => ({ ...s, id: s.id || s.label || String(idx) }))

  const flatValues = allSeries.flatMap((s) => s.data.map((d) => d.value))
  const rawMax = Math.max(...flatValues, 1)
  const rawMin = Math.min(...flatValues, 0)
  const paddedMax = rawMax === 0 ? 1 : rawMax * 1.1
  const paddedMin = Math.min(0, rawMin)
  const unitSuffixPre = (unit || '').trim().toLowerCase()
  let maxValue = Math.ceil(paddedMax)
  let minValue = Math.floor(paddedMin)
  if (unitSuffixPre === 'ms') {
    maxValue = Math.max(1000, Math.ceil(paddedMax / 1000) * 1000)
    minValue = 0
  }
  const valueRange = maxValue - minValue || 1

  const yMin = padding.top + 3
  const yMax = padding.top + chartHeight - 3

  const scaledPoints = data.map((d, i) => {
    const usableW = Math.max(1, chartWidth)
    const x = padding.left + (i / (data.length - 1 || 1)) * usableW
    const rawY = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
    const y = Math.max(yMin, Math.min(yMax, rawY))
    return { x, y }
  })

  const scaledSeries = allSeries.map((s) => {
    const pts = s.data.map((d, i) => {
      const usableW = Math.max(1, chartWidth)
      const x = padding.left + (i / (s.data.length - 1 || 1)) * usableW
      const rawY = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
      const y = Math.max(yMin, Math.min(yMax, rawY))
      return { x, y }
    })
    return { ...s, pts }
  })

  const getSeriesById = (id?: string | null) => scaledSeries.find((s) => s.id === id)
  const visibleSeries = activeSeriesId
    ? scaledSeries.filter((s) => s.id === activeSeriesId)
    : scaledSeries
  const orderedSeries = (() => {
    if (!activeSeriesId) return visibleSeries
    return visibleSeries
  })()

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
      cp1y = Math.max(yMin, Math.min(yMax, cp1y))
      cp2y = Math.max(yMin, Math.min(yMax, cp2y))
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    return d
  })()

  const getCompactDateLabel = (timestamp?: string) => {
    if (!timestamp) return ''
    try {
      const f = formatDate(timestamp)
      return `${f.compactDate} · ${f.compactTime}`
    } catch (e) {
      const d = new Date(timestamp)
      if (Number.isNaN(d.getTime())) return ''
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    }
  }

  const currentHoverDate =
    hoverIndex !== null && data[hoverIndex] ? getCompactDateLabel(data[hoverIndex].timestamp) : ''

  return (
    <div
      ref={containerRef}
      className='w-full overflow-hidden rounded-[11px] border bg-card p-4 shadow-sm'
    >
      <div className='mb-3 flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <h4 className='font-medium text-foreground text-sm'>{label}</h4>
          {allSeries.length > 1 && (
            <div className='flex items-center gap-2'>
              {scaledSeries.slice(1).map((s) => {
                const isActive = activeSeriesId ? activeSeriesId === s.id : true
                const isHovered = hoverSeriesId === s.id
                const dimmed = activeSeriesId ? !isActive : false
                return (
                  <button
                    key={`legend-${s.id}`}
                    type='button'
                    aria-pressed={activeSeriesId === s.id}
                    aria-label={`Toggle ${s.label}`}
                    className='inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]'
                    style={{
                      color: s.color,
                      opacity: dimmed ? 0.4 : isHovered ? 1 : 0.9,
                      border: '1px solid hsl(var(--border))',
                      background: 'transparent',
                    }}
                    onMouseEnter={() => setHoverSeriesId(s.id || null)}
                    onMouseLeave={() => setHoverSeriesId((prev) => (prev === s.id ? null : prev))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setActiveSeriesId((prev) => (prev === s.id ? null : s.id || null))
                      }
                    }}
                    onClick={() =>
                      setActiveSeriesId((prev) => (prev === s.id ? null : s.id || null))
                    }
                  >
                    <span
                      aria-hidden='true'
                      className='inline-block h-[6px] w-[6px] rounded-full'
                      style={{ backgroundColor: s.color }}
                    />
                    <span style={{ color: 'hsl(var(--muted-foreground))' }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {currentHoverDate ? (
          <div className='text-[10px] text-muted-foreground'>{currentHoverDate}</div>
        ) : null}
      </div>
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
            setHoverPos({ x: clamped, y: e.clientY - rect.top })
            const cursorY = e.clientY - rect.top
            if (activeSeriesId) {
              setHoverSeriesId(activeSeriesId)
            } else {
              let best: { id: string | null; dy: number } = {
                id: null,
                dy: Number.POSITIVE_INFINITY,
              }
              for (const s of scaledSeries.slice(1)) {
                const pt = s.pts[i]
                if (!pt) continue
                const dy = Math.abs(pt.y - cursorY)
                if (dy < best.dy) best = { id: s.id || null, dy }
              }
              setHoverSeriesId(best.dy <= 12 ? best.id : null)
            }
          }}
          onMouseLeave={() => {
            setHoverIndex(null)
            setHoverPos(null)
            setHoverSeriesId(null)
          }}
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
                width={Math.max(1, chartWidth)}
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

          {!activeSeriesId && scaledPoints.length > 1 && (
            <path
              d={`${pathD} L ${scaledPoints[scaledPoints.length - 1].x} ${height - padding.bottom} L ${scaledPoints[0].x} ${height - padding.bottom} Z`}
              fill={`url(#area-${label.replace(/\s+/g, '-')})`}
              stroke='none'
              clipPath={`url(#clip-${label.replace(/\s+/g, '-')})`}
            />
          )}

          {orderedSeries.map((s, idx) => {
            const isActive = activeSeriesId ? activeSeriesId === s.id : true
            const isHovered = hoverSeriesId ? hoverSeriesId === s.id : false
            const baseOpacity = isActive ? 1 : 0.12
            const strokeOpacity = isHovered ? 1 : baseOpacity
            const sw = (() => {
              switch ((s.id || '').toLowerCase()) {
                case 'p50':
                  return isDark ? 1.5 : 1.7
                case 'p90':
                  return isDark ? 1.9 : 2.1
                case 'p99':
                  return isDark ? 2.3 : 2.5
                default:
                  return isDark ? 1.7 : 2.0
              }
            })()
            if (s.pts.length <= 1) {
              return (
                <circle
                  key={`pt-${idx}`}
                  cx={s.pts[0]?.x}
                  cy={s.pts[0]?.y}
                  r='3'
                  fill={s.color}
                  opacity={strokeOpacity}
                />
              )
            }
            const p = (() => {
              const p = s.pts
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
                cp1y = Math.max(yMin, Math.min(yMax, cp1y))
                cp2y = Math.max(yMin, Math.min(yMax, cp2y))
                d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
              }
              return d
            })()
            return (
              <path
                key={`series-${idx}`}
                d={p}
                fill='none'
                stroke={s.color}
                strokeWidth={sw}
                strokeLinecap='round'
                clipPath={`url(#clip-${label.replace(/\s+/g, '-')})`}
                style={{ cursor: 'pointer', mixBlendMode: isDark ? 'screen' : 'normal' }}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                opacity={strokeOpacity}
                onClick={() => setActiveSeriesId((prev) => (prev === s.id ? null : s.id || null))}
              />
            )
          })}

          {hoverIndex !== null &&
            scaledPoints[hoverIndex] &&
            scaledPoints.length > 1 &&
            (() => {
              const guideSeries =
                getSeriesById(activeSeriesId) || getSeriesById(hoverSeriesId) || scaledSeries[0]
              const active = guideSeries
              const pt = active.pts[hoverIndex] || scaledPoints[hoverIndex]
              return (
                <g pointerEvents='none' clipPath={`url(#clip-${label.replace(/\s+/g, '-')})`}>
                  <line
                    x1={pt.x}
                    y1={padding.top}
                    x2={pt.x}
                    y2={height - padding.bottom}
                    stroke={active.color}
                    strokeOpacity='0.35'
                    strokeDasharray='3 3'
                  />
                  {activeSeriesId &&
                    (() => {
                      const s = getSeriesById(activeSeriesId)
                      const spt = s?.pts?.[hoverIndex]
                      if (!s || !spt) return null
                      return <circle cx={spt.x} cy={spt.y} r='3' fill={s.color} />
                    })()}
                </g>
              )
            })()}

          {(() => {
            if (data.length < 2) return null
            const usableW = Math.max(1, chartWidth)
            const firstTs = new Date(data[0].timestamp)
            const lastTs = new Date(data[data.length - 1].timestamp)
            const spanMs = Math.abs(lastTs.getTime() - firstTs.getTime())

            const approxLabelWidth = 64
            const desired = Math.min(8, Math.max(3, Math.floor(usableW / approxLabelWidth)))
            const rawIdx = Array.from({ length: desired }, (_, i) =>
              Math.round((i * (data.length - 1)) / Math.max(1, desired - 1))
            )
            const seen = new Set<number>()
            const idx = rawIdx.filter((i) => {
              if (seen.has(i)) return false
              seen.add(i)
              return true
            })

            const formatTick = (d: Date) => {
              if (spanMs <= 36 * 60 * 60 * 1000) {
                return d.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })
              }
              if (spanMs <= 90 * 24 * 60 * 60 * 1000) {
                return d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
              }
              return d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
            }

            return idx.map((i) => {
              const x = padding.left + (i / (data.length - 1 || 1)) * usableW
              const tsSource = data[i]?.timestamp
              if (!tsSource) return null
              const ts = new Date(tsSource)
              const labelStr = Number.isNaN(ts.getTime()) ? '' : formatTick(ts)
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
            const unitSuffix = (unit || '').trim()
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

        {/* No end labels to keep the chart clean and avoid edge overlap */}

        {hoverIndex !== null &&
          scaledPoints[hoverIndex] &&
          (() => {
            const active =
              getSeriesById(activeSeriesId) || getSeriesById(hoverSeriesId) || scaledSeries[0]
            const pt = active.pts[hoverIndex] || scaledPoints[hoverIndex]
            const toDisplay = activeSeriesId
              ? [getSeriesById(activeSeriesId)!]
              : scaledSeries.length > 1
                ? scaledSeries.slice(1)
                : [scaledSeries[0]]

            const fmt = (v?: number) => {
              if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
              const u = unit || ''
              if (u.includes('%')) return `${v.toFixed(1)}%`
              if (u.toLowerCase().includes('ms')) return `${Math.round(v)}ms`
              if (u.toLowerCase().includes('exec')) return `${Math.round(v)}`
              return `${Math.round(v)}${u}`
            }

            const longest = toDisplay.reduce((m, s) => {
              const seriesIndex = allSeries.findIndex((x) => x.id === s.id)
              const v = allSeries[seriesIndex]?.data?.[hoverIndex]?.value
              const valueStr = fmt(v)
              const labelStr = s.label || String(s.id || '')
              const len = `${labelStr} ${valueStr}`.length
              return Math.max(m, len)
            }, 0)
            const tooltipMaxW = Math.min(220, Math.max(80, 7 * longest + 24))
            const anchorX = hoverPos?.x ?? pt.x
            const margin = 10
            const preferRight = anchorX + margin + tooltipMaxW <= width - padding.right
            const left = preferRight
              ? Math.max(
                  padding.left,
                  Math.min(anchorX + margin, width - padding.right - tooltipMaxW)
                )
              : Math.max(
                  padding.left,
                  Math.min(anchorX - margin - tooltipMaxW, width - padding.right - tooltipMaxW)
                )
            const anchorY = hoverPos?.y ?? pt.y
            const top = Math.min(Math.max(anchorY - 26, padding.top), height - padding.bottom - 18)
            return (
              <div
                className='pointer-events-none absolute rounded-md bg-background/80 px-2 py-1 font-medium text-[11px] shadow-sm ring-1 ring-border backdrop-blur'
                style={{ left, top }}
              >
                {toDisplay.map((s) => {
                  const seriesIndex = allSeries.findIndex((x) => x.id === s.id)
                  const val = allSeries[seriesIndex]?.data?.[hoverIndex]?.value
                  return (
                    <div key={`tt-${s.id}`} className='flex items-center gap-1'>
                      <span
                        className='inline-block h-[6px] w-[6px] rounded-full'
                        style={{ backgroundColor: s.color }}
                      />
                      <span style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {s.label || s.id}
                      </span>
                      <span>{fmt(val)}</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
      </div>
    </div>
  )
}

export default LineChart
