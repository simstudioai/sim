'use client'

import { memo, useId, useMemo, useState } from 'react'
import { Button, cn } from '@sim/emcn'
import {
  formatChartCompactNumber,
  formatChartLatency,
  formatChartTimestamp,
} from '@/components/charts/chart-format'
import {
  CHART_AXIS_LABEL_GAP,
  CHART_DEFAULT_HEIGHT,
  CHART_GRID_FRACTIONS,
  CHART_TICK_FILL,
  CHART_TICK_FONT_SIZE,
  chartPlotBand,
  formatTimeTick,
  resolveChartPadding,
  resolveSpanMs,
  resolveTimeTickIndices,
} from '@/components/charts/chart-geometry'
import {
  ChartTooltip,
  ChartTooltipRow,
  estimateTooltipHeight,
  estimateTooltipWidth,
  positionChartTooltip,
} from '@/components/charts/chart-tooltip'
import {
  useChartWidth,
  useIsDarkTheme,
  useResolvedChartColors,
} from '@/components/charts/use-chart-theme'

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

interface LineChartProps {
  data: LineChartPoint[]
  /** Pass `''` for the caller-owned-wrapper form: no card chrome, title, or legend. */
  label: string
  color: string
  unit?: string
  series?: LineChartMultiSeries[]
  height?: number
}

/**
 * Smoothed path through `points`, with every control point clamped into the plot
 * band so a curve between two near-axis samples cannot bow over an axis rule.
 *
 * At module scope because the base line and each extra series need the identical
 * curve: the two copies had drifted apart before, and a clamp fixed in one drew a
 * different shape from the other.
 */
function buildSmoothPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  yMin: number,
  yMax: number
): string {
  if (points.length <= 1) return ''
  const tension = 0.2
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || points[i + 1]
    const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension
    let cp1y = p1.y + ((p2.y - p0.y) / 6) * tension
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension
    let cp2y = p2.y - ((p3.y - p1.y) / 6) * tension
    cp1y = Math.max(yMin, Math.min(yMax, cp1y))
    cp2y = Math.max(yMin, Math.min(yMax, cp2y))
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

function LineChartComponent({
  data,
  label,
  color,
  unit,
  series,
  height = CHART_DEFAULT_HEIGHT,
}: LineChartProps) {
  /*
    `useId`, not `useRef(generateShortId())`: a ref initializer is evaluated on
    every render and all but the first result thrown away, and React already has
    a hook whose whole job is a stable unique id.
  */
  const uniqueId = useId().replace(/:/g, '')
  const [containerRef, containerWidth] = useChartWidth()
  const width = containerWidth ?? 0
  const isDark = useIsDarkTheme()
  const [hoverSeriesId, setHoverSeriesId] = useState<string | null>(null)
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)

  const colorTokens: Record<string, string> = { base: color }
  for (const s of series ?? []) {
    const id = s.id || s.label || ''
    if (id) colorTokens[id] = s.color
  }
  const resolvedColors = useResolvedChartColors(colorTokens)

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

  /**
   * The two y-axis tick labels, resolved once so the gutter that has to hold them is
   * measured from the same strings the axis draws.
   */
  const yAxisLabels = useMemo(() => {
    const unitSuffix = (unit || '').trim()
    const isLatency = unitSuffix.toLowerCase() === 'latency'
    const suffix = unitSuffix === '%' && !isLatency ? unitSuffix : ''
    const compact = (value: number) => {
      if (isLatency) return value === 0 ? '0' : formatChartLatency(value)
      return `${formatChartCompactNumber(value)}${suffix}`
    }
    return [compact(maxValue), compact(minValue)] as const
  }, [maxValue, minValue, unit])

  const padding = resolveChartPadding(yAxisLabels)
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const { yMin, yMax } = chartPlotBand(height)

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

  /**
   * The hovered sample, derived from the stored cursor rather than stored beside it.
   *
   * The x written on hover is the same clamped x the index was resolved from, so a
   * second piece of state could only ever agree with this — or go stale after a
   * resize, once the width it was measured against had changed.
   */
  const hoverIndex =
    hoverPos === null || scaledPoints.length === 0
      ? null
      : Math.round(((hoverPos.x - padding.left) / (chartWidth || 1)) * (scaledPoints.length - 1))

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
  const visibleSeries = activeSeriesId
    ? scaledSeries.filter((s) => s.id === activeSeriesId)
    : scaledSeries

  const pathD = useMemo(() => buildSmoothPath(scaledPoints, yMin, yMax), [scaledPoints, yMin, yMax])

  const currentHoverDate =
    hoverIndex !== null && data[hoverIndex] ? formatChartTimestamp(data[hoverIndex].timestamp) : ''

  if (containerWidth === null) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'w-full',
          !hasExternalWrapper && 'rounded-lg border bg-[var(--surface-1)] p-4'
        )}
        style={{ height }}
      />
    )
  }

  if (data.length === 0) {
    return (
      <div
        className={cn(
          'flex w-full items-center justify-center',
          !hasExternalWrapper && 'rounded-lg border bg-[var(--surface-1)] p-4'
        )}
        /*
          Height only. `width` is floored at CHART_MIN_WIDTH for the plot geometry,
          and pinning the empty state to it pushed a narrow container into horizontal
          overflow to centre two words — this branch draws no axes, so it has nothing
          to protect from compressing.
        */
        style={{ height }}
      >
        <p className='text-[var(--text-muted)] text-sm'>No data</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        /*
          `overflow-x-auto`, not `overflow-hidden`: `useChartWidth` floors the SVG at
          CHART_MIN_WIDTH, so in a narrower container the chart is wider than its box.
          Hiding that silently cut off the rightmost bars and axis labels — and
          contradicted the constant's own note that the chart "scrolls rather than
          compresses". At or above the floor there is no overflow and nothing changes.
        */
        /*
          `overflow-y-hidden` is not redundant with `overflow-x-auto`: a computed
          `overflow-x` other than `visible` promotes `overflow-y: visible` to `auto`,
          so the tooltip's shadow reaching the foot of the box raised a vertical
          scrollbar over the chart whenever the cursor neared the axis.
        */
        'w-full overflow-x-auto overflow-y-hidden',
        !hasExternalWrapper && 'rounded-lg border bg-[var(--surface-1)] p-4 shadow-card'
      )}
    >
      {!hasExternalWrapper && (
        <div className='mb-3 flex items-center gap-3'>
          <h4 className='text-[var(--text-primary)] text-sm'>{label}</h4>
          {allSeries.length > 1 && (
            <div className='flex items-center gap-2'>
              {scaledSeries.slice(1).map((s) => {
                const isActive = activeSeriesId ? activeSeriesId === s.id : true
                const isHovered = hoverSeriesId === s.id
                const dimmed = activeSeriesId ? !isActive : false
                return (
                  <Button
                    key={`legend-${s.id}`}
                    type='button'
                    variant='ghost'
                    aria-pressed={activeSeriesId === s.id}
                    aria-label={`Toggle ${s.label}`}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-micro',
                      dimmed ? 'opacity-40' : isHovered ? 'opacity-100' : 'opacity-90'
                    )}
                    style={{ color: resolvedColors[s.id || ''] || s.color }}
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
                      className='inline-block size-[6px] rounded-xs'
                      style={{ backgroundColor: resolvedColors[s.id || ''] || s.color }}
                    />
                    <span className='text-[var(--text-muted)]'>{s.label}</span>
                  </Button>
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
            stroke='var(--border)'
            strokeWidth='1'
          />

          {CHART_GRID_FRACTIONS.map((p) => (
            <line
              key={`${uniqueId}-grid-${p}`}
              x1={padding.left}
              y1={padding.top + chartHeight * p}
              x2={width - padding.right}
              y2={padding.top + chartHeight * p}
              stroke='var(--border)'
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
                  key={s.id}
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
            const p = buildSmoothPath(s.pts, yMin, yMax)
            return (
              <path
                key={s.id}
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
            const spanMs = resolveSpanMs(data)
            const idx = resolveTimeTickIndices(data.length, usableW)

            return idx.map((i) => {
              const x = padding.left + (i / (data.length - 1 || 1)) * usableW
              const tsSource = data[i]?.timestamp
              if (!tsSource) return null
              const ts = new Date(tsSource)
              const labelStr = Number.isNaN(ts.getTime()) ? '' : formatTimeTick(ts, spanMs)
              return (
                <text
                  key={`${uniqueId}-x-axis-${i}`}
                  x={x}
                  y={height - padding.bottom + 14}
                  fontSize={CHART_TICK_FONT_SIZE}
                  textAnchor='middle'
                  fill={CHART_TICK_FILL}
                >
                  {labelStr}
                </text>
              )
            })
          })()}

          <text
            x={padding.left - CHART_AXIS_LABEL_GAP}
            y={padding.top}
            textAnchor='end'
            fontSize={CHART_TICK_FONT_SIZE}
            fill={CHART_TICK_FILL}
          >
            {yAxisLabels[0]}
          </text>
          <text
            x={padding.left - CHART_AXIS_LABEL_GAP}
            y={height - padding.bottom}
            textAnchor='end'
            fontSize={CHART_TICK_FONT_SIZE}
            fill={CHART_TICK_FILL}
          >
            {yAxisLabels[1]}
          </text>

          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke='var(--border)'
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
              if (u.toLowerCase() === 'latency') return formatChartLatency(v)
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
            const { left, top } = positionChartTooltip({
              anchorX: hoverPos?.x ?? pt.x,
              anchorY: hoverPos?.y ?? pt.y,
              width,
              height,
              tooltipMaxWidth: estimateTooltipWidth(longest),
              tooltipHeight: estimateTooltipHeight(toDisplay.length, Boolean(currentHoverDate)),
              padding,
            })
            return (
              <ChartTooltip left={left} top={top} date={currentHoverDate || undefined}>
                {toDisplay.map((s) => {
                  const seriesIndex = allSeries.findIndex((x) => x.id === s.id)
                  const val = allSeries[seriesIndex]?.data?.[hoverIndex]?.value
                  const seriesLabel = s.label || s.id
                  const showLabel =
                    seriesLabel && seriesLabel !== 'base' && seriesLabel.trim() !== ''
                  return (
                    <ChartTooltipRow
                      key={`tt-${s.id}`}
                      color={resolvedColors[s.id || ''] || s.color}
                      label={showLabel ? seriesLabel : undefined}
                      value={fmt(val)}
                    />
                  )
                })}
              </ChartTooltip>
            )
          })()}
      </div>
    </div>
  )
}

export const LineChart = memo(LineChartComponent)
