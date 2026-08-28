'use client'

import { memo, useId, useMemo, useState } from 'react'
import { truncate } from '@sim/utils/string'
import {
  CHART_GRID_FRACTIONS,
  CHART_TICK_FILL,
  CHART_TICK_FONT_SIZE,
  estimateAxisLabelWidth,
} from '@/components/charts/chart-geometry'
import {
  ChartTooltip,
  ChartTooltipRow,
  estimateTooltipHeight,
  estimateTooltipWidth,
} from '@/components/charts/chart-tooltip'
import {
  useChartWidth,
  useIsDarkTheme,
  useResolvedChartColors,
} from '@/components/charts/use-chart-theme'

export interface RadarChartAxis {
  label: string
  value: number
  /** Text shown for `value` in the hover row. Defaults to the raw number. */
  display?: string
}

interface RadarChartProps {
  axes: RadarChartAxis[]
  color: string
  height?: number
}

/** Room above and below the web for the captions on the vertical centreline. */
const LABEL_GUTTER = 52

/** Gap between the outer ring and a caption anchored beyond it. */
const LABEL_GAP = 12

/**
 * Caption budget. A long source name would otherwise run past the container, and the
 * svg paints outside its box so it would not even clip — it would overlap the section
 * beside it. The hover row carries the full name.
 */
const MAX_LABEL_LENGTH = 16
const RING_COUNT = CHART_GRID_FRACTIONS.length + 1

/**
 * Polar coordinates for an axis. `-90°` puts the first axis at twelve o'clock, so a
 * list read top-down and the web read clockwise start in the same place.
 */
function axisPoint(index: number, count: number, radius: number, cx: number, cy: number) {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
}

function polygon(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

/**
 * Shape of a distribution across a handful of named categories.
 *
 * The third member of the chart family, and built from the same tokens, tooltip, and
 * theme hooks as {@link BarChart} and {@link LineChart}. It answers a question the
 * other two cannot: a bar list ranks categories but says nothing about balance, and
 * "one source dominates" versus "spend is spread evenly" is legible here at a glance
 * and nowhere else on the panel.
 *
 * Every axis is scaled against the largest value rather than against its own range,
 * so the polygon's area is proportional to the real distribution — normalising each
 * axis independently would draw a balanced pentagon for any input at all.
 */
function RadarChartComponent({ axes, color, height = 200 }: RadarChartProps) {
  const uniqueId = useId().replace(/:/g, '')
  const [containerRef, containerWidth] = useChartWidth()
  const isDark = useIsDarkTheme()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const resolvedColors = useResolvedChartColors({ base: color })
  const resolvedColor = resolvedColors.base || color

  const width = containerWidth ?? 0
  const cx = width / 2
  const cy = height / 2
  /*
    The horizontal budget is the caption's own estimated width — the same
    `estimateAxisLabelWidth` the sibling charts use to size a gutter around SVG text
    they cannot measure. A 16-glyph caption runs to ~84px, so a fixed inset let every
    side caption paint past the container and over the section beside it; the svg is
    `overflow-visible`, so nothing clipped it.
  */
  const labelWidth = axes.reduce(
    (max, axis) => Math.max(max, estimateAxisLabelWidth(truncate(axis.label, MAX_LABEL_LENGTH))),
    0
  )
  const radius = Math.max(
    0,
    Math.min(width / 2 - labelWidth - LABEL_GAP, height / 2 - LABEL_GUTTER / 2)
  )

  const maxValue = Math.max(...axes.map((a) => a.value), 0)

  const points = useMemo(
    () =>
      axes.map((axis, index) => {
        const fraction = maxValue > 0 ? axis.value / maxValue : 0
        return {
          axis,
          outer: axisPoint(index, axes.length, radius, cx, cy),
          value: axisPoint(index, axes.length, radius * fraction, cx, cy),
          label: axisPoint(index, axes.length, radius + LABEL_GAP, cx, cy),
        }
      }),
    [axes, maxValue, radius, cx, cy]
  )

  if (containerWidth === null) {
    return <div ref={containerRef} className='w-full' style={{ height }} />
  }

  /*
    Three axes are the fewest that enclose an area; below that the "polygon" is a
    line or a point and reads as a rendering fault rather than as a distribution.
  */
  if (axes.length < 3 || maxValue <= 0) {
    return (
      <div
        ref={containerRef}
        className='flex w-full items-center justify-center'
        style={{ height }}
      >
        <p className='text-[var(--text-muted)] text-sm'>No data</p>
      </div>
    )
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null

  return (
    /*
      The same scroll guard as the sibling charts: `useChartWidth` floors the svg at
      CHART_MIN_WIDTH, so in a narrower box it is wider than its container. The
      captions are inside the box by construction — `radius` is budgeted against
      `labelWidth` — so nothing legible is clipped, and `overflow-y-hidden` keeps the
      `overflow-x` from promoting the vertical axis to `auto`.
    */
    <div
      ref={containerRef}
      className='relative w-full overflow-x-auto overflow-y-hidden'
      style={{ height }}
    >
      <svg width={width} height={height} className='overflow-hidden'>
        <defs>
          <radialGradient id={`radar-${uniqueId}`}>
            <stop offset='0%' stopColor={resolvedColor} stopOpacity={isDark ? 0.45 : 0.3} />
            <stop offset='100%' stopColor={resolvedColor} stopOpacity={isDark ? 0.16 : 0.12} />
          </radialGradient>
        </defs>

        {/* The web: one ring per grid fraction plus the outer ring, and a spoke per axis. */}
        {Array.from({ length: RING_COUNT }, (_, ring) => {
          const ringRadius = (radius * (ring + 1)) / RING_COUNT
          return (
            <polygon
              key={`${uniqueId}-ring-${ring}`}
              points={polygon(
                axes.map((_, index) => axisPoint(index, axes.length, ringRadius, cx, cy))
              )}
              fill='none'
              stroke='var(--border)'
              strokeOpacity={ring === RING_COUNT - 1 ? 0.9 : 0.45}
              strokeWidth='1'
            />
          )
        })}
        {points.map((point, index) => (
          <line
            key={`${uniqueId}-spoke-${point.axis.label}`}
            x1={cx}
            y1={cy}
            x2={point.outer.x}
            y2={point.outer.y}
            stroke='var(--border)'
            strokeOpacity={hoverIndex === index ? 0.9 : 0.45}
            strokeWidth='1'
          />
        ))}

        <polygon
          points={polygon(points.map((point) => point.value))}
          fill={`url(#radar-${uniqueId})`}
          stroke={resolvedColor}
          strokeWidth='1.5'
          strokeLinejoin='round'
        />

        {points.map((point, index) => (
          <circle
            key={`${uniqueId}-vertex-${point.axis.label}`}
            cx={point.value.x}
            cy={point.value.y}
            r={hoverIndex === index ? 3.5 : 2.5}
            fill={resolvedColor}
          />
        ))}

        {points.map((point, index) => (
          <text
            key={`${uniqueId}-label-${point.axis.label}`}
            x={point.label.x}
            y={point.label.y}
            /*
              Anchored away from the centre so a caption never crosses the web: the
              left half ends at its x, the right half starts at it, and the two axes
              sitting on the vertical centreline are centred.
            */
            textAnchor={
              Math.abs(point.label.x - cx) < 1 ? 'middle' : point.label.x > cx ? 'start' : 'end'
            }
            dominantBaseline={Math.abs(point.label.y - cy) < 1 ? 'middle' : 'auto'}
            fontSize={CHART_TICK_FONT_SIZE}
            fill={CHART_TICK_FILL}
          >
            {truncate(point.axis.label, MAX_LABEL_LENGTH)}
          </text>
        ))}

        {/*
          Hit targets last so they sit above the painted web. A wedge per axis, drawn
          as a transparent triangle from the centre — a vertex-sized target is far too
          small to hover on a 200px chart.
        */}
        {points.map((point, index) => {
          const half = Math.PI / axes.length
          const angle = (index / axes.length) * Math.PI * 2 - Math.PI / 2
          const reach = radius + LABEL_GUTTER / 2
          const a = {
            x: cx + Math.cos(angle - half) * reach,
            y: cy + Math.sin(angle - half) * reach,
          }
          const b = {
            x: cx + Math.cos(angle + half) * reach,
            y: cy + Math.sin(angle + half) * reach,
          }
          return (
            <polygon
              key={`${uniqueId}-hit-${point.axis.label}`}
              points={polygon([{ x: cx, y: cy }, a, b])}
              fill='transparent'
              onMouseEnter={() => setHoverIndex(index)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          )
        })}
      </svg>

      {hovered &&
        (() => {
          const value = hovered.axis.display ?? String(hovered.axis.value)
          /*
            Centred on the chart rather than tracked to the cursor. The wedges all
            meet at the centre, so one box there is equidistant from every target and
            cannot be pushed outside a chart that — unlike its axis-bearing siblings —
            has no padding to clamp against.
          */
          const boxWidth = estimateTooltipWidth(Math.max(hovered.axis.label.length, value.length))
          return (
            <ChartTooltip
              left={cx - boxWidth / 2}
              top={cy - estimateTooltipHeight(1, true) / 2}
              date={hovered.axis.label}
            >
              <ChartTooltipRow color={resolvedColor} value={value} />
            </ChartTooltip>
          )
        })()}
    </div>
  )
}

export const RadarChart = memo(RadarChartComponent)
