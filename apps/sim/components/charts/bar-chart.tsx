'use client'

import { memo, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import {
  formatChartCompactNumber,
  formatChartLatency,
  formatChartTimestamp,
} from '@/components/charts/chart-format'
import {
  CHART_DEFAULT_HEIGHT,
  CHART_GRID_FRACTIONS,
  CHART_PADDING,
  CHART_TICK_FILL,
  CHART_TICK_FONT_SIZE,
  chartPlotBand,
  formatTimeTick,
  resolveSpanMs,
  resolveTimeTickIndices,
} from '@/components/charts/chart-geometry'
import {
  ChartTooltip,
  ChartTooltipRow,
  estimateTooltipWidth,
  positionChartTooltip,
} from '@/components/charts/chart-tooltip'
import {
  useChartWidth,
  useIsDarkTheme,
  useResolvedChartColors,
} from '@/components/charts/use-chart-theme'

export interface BarChartPoint {
  timestamp: string
  value: number
}

interface BarChartProps {
  data: BarChartPoint[]
  /** Pass `''` for the caller-owned-wrapper form, mirroring {@link LineChart}. */
  label: string
  color: string
  /** `''` | `'%'` | `'ms'` | `'latency'` | `'credits'` — drives tick and tooltip formatting. */
  unit?: string
  height?: number
  /** Bucket drawn at full opacity, e.g. the period in progress. */
  highlightIndex?: number
}

/**
 * Discrete time buckets as bars.
 *
 * The sibling of {@link LineChart}, and deliberately built from the same geometry,
 * tooltip, and theme modules: a smoothed line implies a continuous signal between
 * samples, which is wrong for a calendar bucket like a day's spend, but the two must
 * still line up pixel-for-pixel when stacked in one card.
 */
function BarChartComponent({
  data,
  label,
  color,
  unit,
  height = CHART_DEFAULT_HEIGHT,
  highlightIndex,
}: BarChartProps) {
  const uniqueId = useRef(`bar-${generateShortId(7)}`).current
  const [containerRef, containerWidth] = useChartWidth()
  const width = containerWidth ?? 0
  const padding = CHART_PADDING
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const { yMin, yMax } = chartPlotBand(height)
  const isDark = useIsDarkTheme()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)

  const colorTokens = useMemo(() => ({ base: color }), [color])
  const resolvedColors = useResolvedChartColors(colorTokens)
  const resolvedColor = resolvedColors.base || color

  const hasExternalWrapper = !label

  /**
   * The track is read against its own background, so its opacity is per-theme
   * rather than one shared value. `--border` is the platform's neutral track
   * token — the same one the proportional row meters use — but it resolves to
   * `#444` on dark and `#d8d8d8` on light, and a strength that reads as a column
   * on near-black is a half-percent delta on white. Hover keeps the same ratio.
   */
  const trackOpacity = isDark ? 0.12 : 0.3
  const trackHoverOpacity = isDark ? 0.22 : 0.5

  const maxValue = useMemo(() => {
    const peak = Math.max(...data.map((d) => d.value), 0)
    return peak <= 0 ? 1 : peak * 1.1
  }, [data])

  /** Slot geometry: every bucket owns an equal slice, with the bar centred in it. */
  const slot = data.length > 0 ? Math.max(1, chartWidth) / data.length : 0
  const barWidth = Math.max(1, Math.min(24, slot * 0.7))

  const bars = useMemo(
    () =>
      data.map((point, index) => {
        const x = padding.left + slot * index + (slot - barWidth) / 2
        const rawY = padding.top + chartHeight - (point.value / maxValue) * chartHeight
        const y = Math.max(yMin, Math.min(yMax, rawY))
        return {
          x,
          y,
          /*
           * A zero bucket draws nothing. The clamp above keeps a *drawn* bar off the
           * axis rule, but applied to zero it floored the bar at the 3px band and
           * every empty day rendered as a small amount of usage — the densified zeros
           * this chart exists to show honestly. Only the track represents an empty
           * bucket.
           */
          height: point.value > 0 ? Math.max(0, height - padding.bottom - y) : 0,
          point,
        }
      }),
    [data, slot, barWidth, maxValue, chartHeight, height, padding.left, padding.top, yMin, yMax]
  )

  const formatValue = (value?: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
    const suffix = (unit ?? '').toLowerCase()
    if (suffix.includes('%')) return `${value.toFixed(1)}%`
    if (suffix === 'latency') return formatChartLatency(value)
    if (suffix.includes('ms')) return `${Math.round(value)}ms`
    if (suffix === 'credits') return formatChartCompactNumber(value)
    return `${Math.round(value)}${unit ?? ''}`
  }

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
      // Keeps the measurement ref: dropping it here left the observer watching a
      // detached node, so a resize while empty was never seen and the next non-empty
      // render laid out at the stale width.
      <div
        ref={containerRef}
        className={cn(
          'flex items-center justify-center',
          !hasExternalWrapper && 'rounded-lg border bg-card p-4'
        )}
        style={{ width, height }}
      >
        <p className='text-[var(--text-muted)] text-sm'>No data</p>
      </div>
    )
  }

  const spanMs = resolveSpanMs(data)
  const tickIndices = resolveTimeTickIndices(data.length, Math.max(1, chartWidth))

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
          <h4 className='text-[var(--text-primary)] text-sm'>{label}</h4>
        </div>
      )}
      <div className='relative' style={{ width, height }}>
        <svg
          width={width}
          height={height}
          className='overflow-hidden'
          onMouseMove={(e) => {
            if (bars.length === 0 || slot <= 0) return
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
            const x = e.clientX - rect.left
            // Bars own a slot, so the hovered bucket is which slot the cursor is in —
            // not the nearest sample, which is how a line chart resolves it.
            const index = Math.max(
              0,
              Math.min(data.length - 1, Math.floor((x - padding.left) / slot))
            )
            setHoverIndex(index)
            setHoverPos({ x, y: e.clientY - rect.top })
          }}
          onMouseLeave={() => {
            setHoverIndex(null)
            setHoverPos(null)
          }}
        >
          <defs>
            <linearGradient id={`bar-${uniqueId}`} x1='0' x2='0' y1='0' y2='1'>
              <stop offset='0%' stopColor={resolvedColor} stopOpacity={isDark ? 0.9 : 1} />
              <stop offset='100%' stopColor={resolvedColor} stopOpacity={isDark ? 0.35 : 0.55} />
            </linearGradient>
          </defs>

          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={height - padding.bottom}
            stroke='hsl(var(--border))'
            strokeWidth='1'
          />

          {CHART_GRID_FRACTIONS.map((fraction) => (
            <line
              key={`${uniqueId}-grid-${fraction}`}
              x1={padding.left}
              y1={padding.top + chartHeight * fraction}
              x2={width - padding.right}
              y2={padding.top + chartHeight * fraction}
              stroke='hsl(var(--muted))'
              strokeOpacity='0.35'
              strokeWidth='1'
            />
          ))}

          {/*
            A full-height track keeps an empty bucket visible and gives every slot
            the same hover target, so a run of zero days reads as zero rather than
            as missing data.

            Drawn outside the blend group below: the bars want `screen` on dark so
            the gradient stays luminous, but a track composited that way is only
            legible against a dark background, and on white it disappears.
          */}
          <g>
            {bars.map((bar, index) => (
              <rect
                key={`${uniqueId}-track-${bar.point.timestamp}`}
                x={bar.x}
                y={padding.top}
                width={barWidth}
                height={chartHeight}
                rx='2'
                fill='var(--border)'
                fillOpacity={hoverIndex === index ? trackHoverOpacity : trackOpacity}
              />
            ))}
          </g>

          <g style={{ mixBlendMode: isDark ? 'screen' : 'normal' }}>
            {bars.map(
              (bar, index) =>
                bar.height > 0 && (
                  <rect
                    key={`${uniqueId}-bar-${bar.point.timestamp}`}
                    x={bar.x}
                    y={bar.y}
                    width={barWidth}
                    height={bar.height}
                    rx='2'
                    fill={`url(#bar-${uniqueId})`}
                    opacity={
                      highlightIndex !== undefined && highlightIndex !== index
                        ? 0.55
                        : hoverIndex !== null && hoverIndex !== index
                          ? 0.75
                          : 1
                    }
                  />
                )
            )}
          </g>

          {tickIndices.map((index) => {
            const timestamp = data[index]?.timestamp
            if (!timestamp) return null
            const date = new Date(timestamp)
            return (
              <text
                key={`${uniqueId}-x-axis-${index}`}
                x={padding.left + slot * index + slot / 2}
                y={height - padding.bottom + 14}
                fontSize={CHART_TICK_FONT_SIZE}
                textAnchor='middle'
                fill={CHART_TICK_FILL}
              >
                {Number.isNaN(date.getTime()) ? '' : formatTimeTick(date, spanMs)}
              </text>
            )
          })}

          <text
            x={padding.left - 8}
            y={padding.top}
            textAnchor='end'
            fontSize={CHART_TICK_FONT_SIZE}
            fill={CHART_TICK_FILL}
          >
            {/* Same formatter the tooltip uses, or the axis and the hover disagree
                about what the numbers mean on any non-`credits` unit. */}
            {formatValue(maxValue)}
          </text>
          <text
            x={padding.left - 8}
            y={height - padding.bottom}
            textAnchor='end'
            fontSize={CHART_TICK_FONT_SIZE}
            fill={CHART_TICK_FILL}
          >
            0
          </text>

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
          bars[hoverIndex] &&
          (() => {
            const bar = bars[hoverIndex]
            const value = formatValue(bar.point.value)
            const { left, top } = positionChartTooltip({
              anchorX: hoverPos?.x ?? bar.x,
              anchorY: hoverPos?.y ?? bar.y,
              width,
              height,
              tooltipMaxWidth: estimateTooltipWidth(value.length),
            })
            return (
              <ChartTooltip
                left={left}
                top={top}
                date={formatChartTimestamp(bar.point.timestamp) || undefined}
              >
                <ChartTooltipRow color={resolvedColor} value={value} />
              </ChartTooltip>
            )
          })()}
      </div>
    </div>
  )
}

export const BarChart = memo(BarChartComponent)
