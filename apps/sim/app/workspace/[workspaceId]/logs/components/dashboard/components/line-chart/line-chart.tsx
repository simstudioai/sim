import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { formatDate, formatLatency } from '@/app/workspace/[workspaceId]/logs/utils'

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

function LineChartComponent({
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
  const uniqueId = useRef(`chart-${Math.random().toString(36).substring(2, 9)}`).current
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const width = containerWidth ?? 0
  const height = 166
  const padding = { top: 16, right: 28, bottom: 26, left: 26 }
  useEffect(() => {
    if (!containerRef.current) return
    const element = containerRef.current
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry?.contentRect && entry.contentRect.width > 0) {
        const w = Math.max(280, Math.floor(entry.contentRect.width))
        setContainerWidth(w)
      }
    })
    ro.observe(element)
    const rect = element.getBoundingClientRect()
    if (rect?.width && rect.width > 0) setContainerWidth(Math.max(280, Math.floor(rect.width)))
    return () => ro.disconnect()
  }, [])
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isDark, setIsDark] = useState<boolean>(true)
  const [hoverSeriesId, setHoverSeriesId] = useState<string | null>(null)
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [resolvedColors, setResolvedColors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    const el = document.documentElement
    const update = () => setIsDark(el.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const resolveColor = (c: string): string => {
      if (!c.startsWith('var(')) return c

      const tempEl = document.createElement('div')
      tempEl.style.color = c
      document.body.appendChild(tempEl)
      const computed = window.getComputedStyle(tempEl).color
      document.body.removeChild(tempEl)
      return computed
    }

    const colorMap: Record<string, string> = { base: resolveColor(color) }
    const allSeriesToResolve = Array.isArray(series) && series.length > 0 ? series : []

    for (const s of allSeriesToResolve) {
      const id = s.id || s.label || ''
      if (id) colorMap[id] = resolveColor(s.color)
    }

    setResolvedColors(colorMap)
  }, [color, series])

  const hasExternalWrapper = !label || label === ''

  const allSeries = useMemo(
    () =>
      (Array.isArray(series) && series.length > 0
        ? [{ id: 'base', label, color, data }, ...series]
        : [{ id: 'base', label, color, data }]
      ).map((s, idx) => ({ ...s, id: s.id || s.label || String(idx) })),
    [series, label, color, data]
  )

  const { maxValue, minValue, valueRange } = useMemo(() => {
    const flatValues = allSeries.flatMap((s) => s.data.map((d) => d.value))
    const rawMax = Math.max(...flatValues, 1)
    const rawMin = Math.min(...flatValues, 0)
    const paddedMax = rawMax === 0 ? 1 : rawMax * 1.1
    const paddedMin = Math.min(0, rawMin)
    const unitSuffixPre = (unit || '').trim().toLowerCase()
    let maxVal = Math.ceil(paddedMax)
    let minVal = Math.floor(paddedMin)
    if (unitSuffixPre === 'ms' || unitSuffixPre === 'latency') {
      minVal = 0
      if (paddedMax < 10) {
        maxVal = Math.ceil(paddedMax)
      } else if (paddedMax < 100) {
        maxVal = Math.ceil(paddedMax / 10) * 10
      } else if (paddedMax < 1000) {
        maxVal = Math.ceil(paddedMax / 50) * 50
      } else if (paddedMax < 10000) {
        maxVal = Math.ceil(paddedMax / 500) * 500
      } else {
        maxVal = Math.ceil(paddedMax / 1000) * 1000
      }
    }
    return {
      maxValue: maxVal,
      minValue: minVal,
      valueRange: maxVal - minVal || 1,
    }
  }, [allSeries, unit])

  const yMin = padding.top + 3
  const yMax = padding.top + chartHeight - 3

  const scaledPoints = useMemo(
    () =>
      data.map((d, i) => {
        const usableW = Math.max(1, chartWidth)
        const x = padding.left + (i / (data.length - 1 || 1)) * usableW
        const rawY = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
        const y = Math.max(yMin, Math.min(yMax, rawY))
        return { x, y }
      }),
    [data, chartWidth, chartHeight, minValue, valueRange, yMin, yMax, padding.left, padding.top]
  )

  const scaledSeries = useMemo(
    () =>
      allSeries.map((s) => {
        const pts = s.data.map((d, i) => {
          const usableW = Math.max(1, chartWidth)
          const x = padding.left + (i / (s.data.length - 1 || 1)) * usableW
          const rawY = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
          const y = Math.max(yMin, Math.min(yMax, rawY))
          return { x, y }
        })
        return { ...s, pts }
      }),
    [
      allSeries,
      chartWidth,
      chartHeight,
      minValue,
      valueRange,
      yMin,
      yMax,
      padding.left,
      padding.top,
    ]
  )

  const getSeriesById = (id?: string | null) => scaledSeries.find((s) => s.id === id)
  const visibleSeries = useMemo(
    () => (activeSeriesId ? scaledSeries.filter((s) => s.id === activeSeriesId) : scaledSeries),
    [activeSeriesId, scaledSeries]
  )

  const pathD = useMemo(() => {
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
  }, [scaledPoints, yMin, yMax])

  const getCompactDateLabel = (timestamp?: string) => {
    if (!timestamp) return ''
    try {
      const f = formatDate(timestamp)
      return `${f.compactDate} ${f.compactTime}`
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

  if (containerWidth === null) {
    return (
      <div
        ref={containerRef}
        className={cn('w-full', !hasExternalWrapper && 'rounded-lg border bg-card p-4')}
        style={{ height }}
      />
    )
  }

  if (data.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center',
          !hasExternalWrapper && 'rounded-lg border bg-card p-4'
        )}
        style={{ width, height }}
      >
        <p className='text-muted-foreground text-sm'>No data</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full overflow-hidden',
        !hasExternalWrapper && 'rounded-[11px] border bg-card p-4 shadow-sm'
      )}
    >
      {!hasExternalWrapper && (
        <div className='mb-3 flex items-center gap-3'>
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
                      color: resolvedColors[s.id || ''] || s.color,
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
                      className='inline-block h-[6px] w-[6px] rounded-[2px]'
                      style={{ backgroundColor: resolvedColors[s.id || ''] || s.color }}
                    />
                    <span style={{ color: 'hsl(var(--muted-foreground))' }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
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
            <linearGradient id={`area-${uniqueId}`} x1='0' x2='0' y1='0' y2='1'>
              <stop
                offset='0%'
                stopColor={resolvedColors.base || color}
                stopOpacity={isDark ? 0.25 : 0.45}
              />
              <stop
                offset='100%'
                stopColor={resolvedColors.base || color}
                stopOpacity={isDark ? 0.03 : 0.08}
              />
            </linearGradient>
            <clipPath id={`clip-${uniqueId}`}>
              <rect
                x={padding.left - 3}
                y={yMin}
                width={Math.max(1, chartWidth + 6)}
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
              key={`${uniqueId}-grid-${p}`}
              x1={padding.left}
              y1={padding.top + chartHeight * p}
              x2={width - padding.right}
              y2={padding.top + chartHeight * p}
              stroke='hsl(var(--muted))'
              strokeOpacity='0.35'
              strokeWidth='1'
            />
          ))}

          {!activeSeriesId && scaledPoints.length > 1 && (
            <path
              d={`${pathD} L ${scaledPoints[scaledPoints.length - 1].x} ${height - padding.bottom} L ${scaledPoints[0].x} ${height - padding.bottom} Z`}
              fill={`url(#area-${uniqueId})`}
              stroke='none'
              clipPath={`url(#clip-${uniqueId})`}
            />
          )}

          {!activeSeriesId &&
            scaledPoints.length === 1 &&
            (() => {
              const strokeWidth = isDark ? 1.7 : 2.0
              const capExtension = strokeWidth / 2
              return (
                <rect
                  x={padding.left - capExtension}
                  y={scaledPoints[0].y}
                  width={Math.max(1, chartWidth + capExtension * 2)}
                  height={height - padding.bottom - scaledPoints[0].y}
                  fill={`url(#area-${uniqueId})`}
                  clipPath={`url(#clip-${uniqueId})`}
                />
              )
            })()}

          {visibleSeries.map((s, idx) => {
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
              const y = s.pts[0]?.y
              if (y === undefined) return null
              return (
                <line
                  key={`pt-${idx}`}
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke={resolvedColors[s.id || ''] || s.color}
                  strokeWidth={sw}
                  strokeLinecap='round'
                  opacity={strokeOpacity}
                  strokeDasharray={s.dashed ? '5 4' : undefined}
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
                stroke={resolvedColors[s.id || ''] || s.color}
                strokeWidth={sw}
                strokeLinecap='round'
                clipPath={`url(#clip-${uniqueId})`}
                style={{ mixBlendMode: isDark ? 'screen' : 'normal' }}
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
                <g pointerEvents='none' clipPath={`url(#clip-${uniqueId})`}>
                  <line
                    x1={pt.x}
                    y1={padding.top}
                    x2={pt.x}
                    y2={height - padding.bottom}
                    stroke={resolvedColors[active.id || ''] || active.color}
                    strokeOpacity='0.35'
                    strokeDasharray='3 3'
                  />
                  {activeSeriesId &&
                    (() => {
                      const s = getSeriesById(activeSeriesId)
                      const spt = s?.pts?.[hoverIndex]
                      if (!s || !spt) return null
                      return (
                        <circle
                          cx={spt.x}
                          cy={spt.y}
                          r='3'
                          fill={resolvedColors[s.id || ''] || s.color}
                        />
                      )
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
                  key={`${uniqueId}-x-axis-${i}`}
                  x={x}
                  y={height - padding.bottom + 14}
                  fontSize='9'
                  textAnchor='middle'
                  fill='var(--text-tertiary)'
                >
                  {labelStr}
                </text>
              )
            })
          })()}

          {(() => {
            const unitSuffix = (unit || '').trim()
            const showInTicks = unitSuffix === '%'
            const isLatency = unitSuffix.toLowerCase() === 'latency'
            const fmtCompact = (v: number) => {
              if (isLatency) {
                if (v === 0) return '0'
                return formatLatency(v)
              }
              return new Intl.NumberFormat('en-US', {
                notation: 'compact',
                maximumFractionDigits: 1,
              })
                .format(v)
                .toLowerCase()
            }
            return (
              <>
                <text
                  x={padding.left - 8}
                  y={padding.top}
                  textAnchor='end'
                  fontSize='9'
                  fill='var(--text-tertiary)'
                >
                  {fmtCompact(maxValue)}
                  {showInTicks && !isLatency ? unit : ''}
                </text>
                <text
                  x={padding.left - 8}
                  y={height - padding.bottom}
                  textAnchor='end'
                  fontSize='9'
                  fill='var(--text-tertiary)'
                >
                  {fmtCompact(minValue)}
                  {showInTicks && !isLatency ? unit : ''}
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
              if (u.toLowerCase() === 'latency') return formatLatency(v)
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
                className='pointer-events-none absolute rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-1)] px-[8px] py-[6px] font-medium text-[11px] shadow-lg'
                style={{ left, top }}
              >
                {currentHoverDate && (
                  <div className='mb-1 text-[10px] text-[var(--text-tertiary)]'>
                    {currentHoverDate}
                  </div>
                )}
                {toDisplay.map((s) => {
                  const seriesIndex = allSeries.findIndex((x) => x.id === s.id)
                  const val = allSeries[seriesIndex]?.data?.[hoverIndex]?.value
                  const seriesLabel = s.label || s.id
                  const showLabel =
                    seriesLabel && seriesLabel !== 'base' && seriesLabel.trim() !== ''
                  return (
                    <div key={`tt-${s.id}`} className='flex items-center gap-[8px]'>
                      <span
                        className='inline-block h-[6px] w-[6px] rounded-[2px]'
                        style={{ backgroundColor: resolvedColors[s.id || ''] || s.color }}
                      />
                      {showLabel && (
                        <span className='text-[var(--text-secondary)]'>{seriesLabel}</span>
                      )}
                      <span className='text-[var(--text-primary)]'>{fmt(val)}</span>
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

/**
 * Memoized LineChart component to prevent re-renders when parent updates.
 */
export const LineChart = memo(LineChartComponent)
export default LineChart
