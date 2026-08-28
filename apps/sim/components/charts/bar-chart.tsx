'use client'

import { memo, useId, useMemo, useState } from 'react'
import { cn } from '@sim/emcn'
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

/** Tick and tooltip text for a bucket's value, in the caller's unit. */
function formatBarValue(value: number | undefined, unit: string | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const suffix = (unit ?? '').toLowerCase()
  if (suffix.includes('%')) return `${value.toFixed(1)}%`
  if (suffix === 'latency') return formatChartLatency(value)
  if (suffix.includes('ms')) return `${Math.round(value)}ms`
  if (suffix === 'credits') return formatChartCompactNumber(value)
  return `${Math.round(value)}${unit ?? ''}`
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
  /*
    `useId`, not `useRef(generateShortId())`: a ref initializer is evaluated on
    every render and all but the first result thrown away, and React already has
    a hook whose whole job is a stable unique id.
  */
  const uniqueId = useId().replace(/:/g, '')
  const [containerRef, containerWidth] = useChartWidth()
  const width = containerWidth ?? 0
  const { yMin, yMax } = chartPlotBand(height)
  const isDark = useIsDarkTheme()
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)

  const resolvedColors = useResolvedChartColors({ base: color })
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

  const padding = resolveChartPadding([formatBarValue(maxValue, unit), '0'])
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  /** Slot geometry: every bucket owns an equal slice, with the bar centred in it. */
  const slot = data.length > 0 ? Math.max(1, chartWidth) / data.length : 0
  const barWidth = Math.max(1, Math.min(24, slot * 0.7))

  /**
   * Bars own a slot, so the hovered bucket is which slot the cursor is in — not the
   * nearest sample, which is how a line chart resolves it. Derived, so a resize
   * mid-hover cannot leave an index disagreeing with the slot geometry.
   */
  const hoverIndex =
    hoverPos === null || data.length === 0 || slot <= 0
      ? null
      : Math.max(0, Math.min(data.length - 1, Math.floor((hoverPos.x - padding.left) / slot)))

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
      // Keeps the measurement ref: dropping it here left the observer watching a
      // detached node, so a resize while empty was never seen and the next non-empty
      // render laid out at the stale width.
      <div
        ref={containerRef}
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

  const spanMs = resolveSpanMs(data)
  const tickIndices = resolveTimeTickIndices(data.length, Math.max(1, chartWidth))

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
        'w-full overflow-x-auto overflow-y-hidden',
        !hasExternalWrapper && 'rounded-lg border bg-[var(--surface-1)] p-4 shadow-card'
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
            setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
          }}
          onMouseLeave={() => setHoverPos(null)}
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
            stroke='var(--border)'
            strokeWidth='1'
          />

          {CHART_GRID_FRACTIONS.map((fraction) => (
            <line
              key={`${uniqueId}-grid-${fraction}`}
              x1={padding.left}
              y1={padding.top + chartHeight * fraction}
              x2={width - padding.right}
              y2={padding.top + chartHeight * fraction}
              stroke='var(--border)'
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
            x={padding.left - CHART_AXIS_LABEL_GAP}
            y={padding.top}
            textAnchor='end'
            fontSize={CHART_TICK_FONT_SIZE}
            fill={CHART_TICK_FILL}
          >
            {/* Same formatter the tooltip uses, or the axis and the hover disagree
                about what the numbers mean on any non-`credits` unit. */}
            {formatBarValue(maxValue, unit)}
          </text>
          <text
            x={padding.left - CHART_AXIS_LABEL_GAP}
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
            stroke='var(--border)'
            strokeWidth='1'
          />
        </svg>

        {hoverIndex !== null &&
          bars[hoverIndex] &&
          (() => {
            const bar = bars[hoverIndex]
            const value = formatBarValue(bar.point.value, unit)
            const date = formatChartTimestamp(bar.point.timestamp)
            const { left, top } = positionChartTooltip({
              anchorX: hoverPos?.x ?? bar.x,
              anchorY: hoverPos?.y ?? bar.y,
              width,
              height,
              tooltipMaxWidth: estimateTooltipWidth(value.length),
              tooltipHeight: estimateTooltipHeight(1, Boolean(date)),
              padding,
            })
            return (
              <ChartTooltip left={left} top={top} date={date || undefined}>
                <ChartTooltipRow color={resolvedColor} value={value} />
              </ChartTooltip>
            )
          })()}
      </div>
    </div>
  )
}

export const BarChart = memo(BarChartComponent)
