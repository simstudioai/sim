'use client'

import { memo, useId, useMemo, useState } from 'react'
import {
  CHART_AXIS_LABEL_GAP,
  CHART_DEFAULT_HEIGHT,
  CHART_GRID_FRACTIONS,
  CHART_TICK_FILL,
  CHART_TICK_FONT_SIZE,
  ChartDataTable,
  ChartTooltip,
  ChartTooltipRow,
  chartPlotBand,
  cn,
  estimateTooltipHeight,
  estimateTooltipWidth,
  formatChartCompactNumber,
  formatChartDate,
  formatChartLatency,
  formatChartTimestamp,
  formatTimeTick,
  positionChartTooltip,
  resolveChartPadding,
  resolveSpanMs,
  resolveTimeTickIndices,
  useChartWidth,
  useIsDarkTheme,
} from '@sim/emcn'

export interface BarChartPoint {
  timestamp: string
  value: number
}

/** One layer of a stacked chart. Every layer shares the first layer's buckets, by index. */
export interface BarChartSeries {
  id: string
  label: string
  color: string
  data: BarChartPoint[]
}

interface BarChartBaseProps {
  /** Pass `''` for the caller-owned-wrapper form, mirroring {@link LineChart}. */
  label: string
  /** `''` | `'%'` | `'ms'` | `'latency'` | `'credits'` — drives tick and tooltip formatting. */
  unit?: string
  height?: number
  /** Display bucket dates in this zone; omitted uses the viewer’s local zone. */
  timeZone?: string
  /** Calendar buckets retain date labels even for a single day. */
  xAxisFormat?: 'auto' | 'date'
  /** Bucket drawn at full opacity, e.g. the period in progress. */
  highlightIndex?: number
}

interface SingleSeriesBarChartProps extends BarChartBaseProps {
  data: BarChartPoint[]
  color: string
  series?: never
  highlightedSeriesId?: never
}

interface StackedBarChartProps extends BarChartBaseProps {
  /** Drawn bottom-up in this order, which should be the legend's order. */
  series: BarChartSeries[]
  /** Dims every other layer, e.g. while its legend entry is hovered. */
  highlightedSeriesId?: string | null
  data?: never
  color?: never
}

export type BarChartProps = SingleSeriesBarChartProps | StackedBarChartProps

/**
 * Tick and tooltip text for a bucket's value, in the caller's unit. `exact` is for
 * the tooltip, where a figure is read in full rather than fitted to the axis gutter.
 */
function formatBarValue(
  value: number | undefined,
  unit: string | undefined,
  { exact = false }: { exact?: boolean } = {}
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const suffix = (unit ?? '').toLowerCase()
  if (suffix.includes('%')) return `${value.toFixed(1)}%`
  if (suffix === 'latency') return formatChartLatency(value)
  if (suffix.includes('ms')) return `${Math.round(value)}ms`
  if (suffix === 'credits' && !exact) return formatChartCompactNumber(value)
  return `${Math.round(value).toLocaleString()}${suffix === 'credits' ? '' : (unit ?? '')}`
}

/** Discrete time buckets using the shared chart geometry and tooltip; one layer or a stack. */
function BarChartComponent(props: BarChartProps) {
  const {
    label,
    unit,
    height = CHART_DEFAULT_HEIGHT,
    highlightIndex,
    timeZone,
    xAxisFormat = 'auto',
  } = props
  const isStacked = props.series !== undefined
  const highlightedSeriesId = props.highlightedSeriesId ?? null
  const uniqueId = useId().replace(/:/g, '')
  const [containerRef, containerWidth] = useChartWidth()
  const width = containerWidth ?? 0
  const { yMin, yMax } = chartPlotBand(height)
  const isDark = useIsDarkTheme()
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)

  const hasExternalWrapper = !label

  /** Tracks need stronger opacity on light backgrounds to remain visible. */
  const trackOpacity = isDark ? 0.12 : 0.3
  const trackHoverOpacity = isDark ? 0.22 : 0.5

  const layers = useMemo<BarChartSeries[]>(
    () =>
      props.series ?? [
        { id: 'value', label: unit || 'Value', color: props.color, data: props.data },
      ],
    [props.series, props.color, props.data, unit]
  )
  const buckets = layers[0]?.data ?? []

  const totals = useMemo(
    () =>
      buckets.map((_, index) =>
        layers.reduce((sum, layer) => sum + Math.max(0, layer.data[index]?.value ?? 0), 0)
      ),
    [buckets, layers]
  )

  const maxValue = useMemo(() => {
    const peak = Math.max(...totals, 0)
    return peak <= 0 ? 1 : unit ? peak * 1.1 : Math.ceil(peak * 1.1)
  }, [totals, unit])

  const maximumLabel = unit ? formatBarValue(maxValue, unit) : formatChartCompactNumber(maxValue)
  const padding = resolveChartPadding([maximumLabel, '0'])
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const slot = buckets.length > 0 ? Math.max(1, chartWidth) / buckets.length : 0
  const barWidth = Math.max(1, Math.min(24, slot * 0.7))

  /** Derive the hovered slot after resizing so the index stays within the current geometry. */
  const hoverIndex =
    hoverPos === null || buckets.length === 0 || slot <= 0
      ? null
      : Math.max(0, Math.min(buckets.length - 1, Math.floor((hoverPos.x - padding.left) / slot)))

  /**
   * One column per bucket, its segments stacked bottom-up. The column's total is
   * clamped into the plot band once and each segment takes its share of that height,
   * so a stack can never overshoot the band that a single bar is held to.
   */
  const columns = useMemo(
    () =>
      buckets.map((point, index) => {
        const x = padding.left + slot * index + (slot - barWidth) / 2
        const total = totals[index] ?? 0
        const rawTop = padding.top + chartHeight - (total / maxValue) * chartHeight
        const top = Math.max(yMin, Math.min(yMax, rawTop))
        const baseline = height - padding.bottom
        /** Empty buckets must stay at zero despite the plot-band clamp. */
        const columnHeight = total > 0 ? Math.max(0, baseline - top) : 0
        let cursor = baseline
        const segments = layers.flatMap((layer) => {
          const value = Math.max(0, layer.data[index]?.value ?? 0)
          if (value <= 0 || total <= 0) return []
          const segmentHeight = (value / total) * columnHeight
          cursor -= segmentHeight
          return [{ layer, y: cursor, height: segmentHeight }]
        })
        return { x, top, height: columnHeight, point, segments }
      }),
    [
      buckets,
      totals,
      layers,
      slot,
      barWidth,
      maxValue,
      chartHeight,
      height,
      padding.left,
      padding.top,
      padding.bottom,
      yMin,
      yMax,
    ]
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

  if (buckets.length === 0) {
    return (
      /** Keeps the measurement ref: dropping it here left the observer watching a */
      /** detached node, so a resize while empty was never seen and the next non-empty */
      /** render laid out at the stale width. */
      <div
        ref={containerRef}
        className={cn(
          'flex w-full items-center justify-center',
          !hasExternalWrapper && 'rounded-lg border bg-[var(--surface-1)] p-4'
        )}
        style={{ height }}
      >
        <p className='text-[var(--text-muted)] text-sm'>No data</p>
      </div>
    )
  }

  const spanMs = resolveSpanMs(buckets)
  const tickIndices = resolveTimeTickIndices(buckets.length, Math.max(1, chartWidth))

  /** Opacity for one segment, combining the legend highlight with the hovered and current bucket. */
  const segmentOpacity = (layerId: string, index: number): number => {
    if (highlightedSeriesId !== null && highlightedSeriesId !== layerId) return 0.2
    if (highlightIndex !== undefined && highlightIndex !== index) return 0.55
    if (hoverIndex !== null && hoverIndex !== index) return 0.75
    return 1
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        /** Scroll below the minimum plot width without introducing a vertical scrollbar. */
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
        <ChartDataTable
          label={label || 'Values by date'}
          series={layers}
          timeZone={timeZone}
          xAxisFormat={xAxisFormat}
        />
        <svg
          aria-hidden='true'
          width={width}
          height={height}
          className='overflow-hidden'
          onMouseMove={(e) => {
            if (columns.length === 0 || slot <= 0) return
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
            setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
          }}
          onMouseLeave={() => setHoverPos(null)}
        >
          {!isStacked && (
            <defs>
              <linearGradient id={`bar-${uniqueId}`} x1='0' x2='0' y1='0' y2='1'>
                <stop offset='0%' stopColor={layers[0]?.color} stopOpacity={isDark ? 0.9 : 1} />
                <stop
                  offset='100%'
                  stopColor={layers[0]?.color}
                  stopOpacity={isDark ? 0.35 : 0.55}
                />
              </linearGradient>
            </defs>
          )}

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

          {/** Tracks preserve empty buckets and hover targets; keep them outside the screen blend. */}
          <g>
            {columns.map((column, index) => (
              <rect
                key={`${uniqueId}-track-${column.point.timestamp}`}
                x={column.x}
                y={padding.top}
                width={barWidth}
                height={chartHeight}
                rx='2'
                fill='var(--border)'
                fillOpacity={hoverIndex === index ? trackHoverOpacity : trackOpacity}
                className='transition-[fill-opacity] duration-150 motion-reduce:transition-none'
              />
            ))}
          </g>

          {/**
           * Each column is one bar: its segments are square and clipped to a single
           * rounded outline, so only the bar's ends are rounded and a stack reads as one
           * shape split by color. A segment reaches half a pixel below its own bottom so
           * the one beneath never shows an anti-aliased seam through the join.
           */}
          <defs>
            {columns.map((column, index) =>
              column.segments.length === 0 ? null : (
                <clipPath
                  key={`${uniqueId}-column-${column.point.timestamp}`}
                  id={`${uniqueId}-column-${index}`}
                >
                  <rect
                    x={column.x}
                    y={column.top}
                    width={barWidth}
                    height={column.height}
                    rx='2'
                  />
                </clipPath>
              )
            )}
          </defs>
          <g style={{ mixBlendMode: isDark && !isStacked ? 'screen' : 'normal' }}>
            {columns.map((column, index) => (
              <g
                key={`${uniqueId}-bar-${column.point.timestamp}`}
                clipPath={`url(#${uniqueId}-column-${index})`}
              >
                {column.segments.map((segment) => (
                  <rect
                    key={segment.layer.id}
                    x={column.x}
                    y={segment.y}
                    width={barWidth}
                    height={segment.height + 0.5}
                    fill={isStacked ? segment.layer.color : `url(#bar-${uniqueId})`}
                    className='transition-opacity duration-150 motion-reduce:transition-none'
                    opacity={segmentOpacity(segment.layer.id, index)}
                  />
                ))}
              </g>
            ))}
          </g>

          {tickIndices.map((index) => {
            const timestamp = buckets[index]?.timestamp
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
                {Number.isNaN(date.getTime())
                  ? ''
                  : formatTimeTick(date, spanMs, timeZone, xAxisFormat)}
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
            {/** Same formatter the tooltip uses, or the axis and the hover disagree
                about what the numbers mean on any non-`credits` unit. */}
            {maximumLabel}
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
          columns[hoverIndex] &&
          (() => {
            const column = columns[hoverIndex]
            /** A calendar bucket has no meaningful time of day. */
            const date =
              xAxisFormat === 'date'
                ? formatChartDate(column.point.timestamp, timeZone)
                : formatChartTimestamp(column.point.timestamp, timeZone)
            /** Top of the stack first, matching the order the eye reads the column in. */
            const rows = isStacked
              ? [...column.segments].reverse().map((segment) => ({
                  id: segment.layer.id,
                  color: segment.layer.color,
                  label: segment.layer.label,
                  value: formatBarValue(segment.layer.data[hoverIndex]?.value, unit, {
                    exact: true,
                  }),
                }))
              : [
                  {
                    id: 'value',
                    color: layers[0]?.color ?? 'currentColor',
                    label: undefined,
                    value: formatBarValue(column.point.value, unit, { exact: true }),
                  },
                ]
            const total = isStacked
              ? formatBarValue(totals[hoverIndex], unit, { exact: true })
              : null
            const longestRow = Math.max(
              ...rows.map((row) => `${row.label ?? ''} ${row.value}`.length),
              total ? `Total ${total}`.length : 0
            )
            const { left, top } = positionChartTooltip({
              anchorX: hoverPos?.x ?? column.x,
              anchorY: hoverPos?.y ?? column.top,
              width,
              height,
              tooltipMaxWidth: estimateTooltipWidth(longestRow),
              tooltipHeight: estimateTooltipHeight(rows.length + (total ? 1 : 0), Boolean(date)),
              padding,
            })
            return (
              <ChartTooltip left={left} top={top} date={date || undefined}>
                {rows.map((row) => (
                  <ChartTooltipRow
                    key={row.id}
                    color={row.color}
                    label={row.label}
                    value={row.value}
                  />
                ))}
                {total && <ChartTooltipRow color='transparent' label='Total' value={total} />}
              </ChartTooltip>
            )
          })()}
      </div>
    </div>
  )
}

export const BarChart = memo(BarChartComponent)
