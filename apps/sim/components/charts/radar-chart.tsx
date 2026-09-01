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
  positionChartTooltip,
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
 * The web's rings: the family's gridline fractions plus the outer ring, which is this
 * chart's axis rule. Read from the constant rather than divided into `RING_COUNT`
 * even steps — the arithmetic agreed with the siblings only while the fractions
 * happened to be uniform, which is exactly the drift `chart-geometry` exists to stop.
 */
const RING_FRACTIONS = [...CHART_GRID_FRACTIONS, 1] as const

/**
 * Caption budget. A long source name would otherwise run past the container, and the
 * svg paints outside its box so it would not even clip — it would overlap the section
 * beside it. The hover row carries the full name.
 */
const MAX_LABEL_LENGTH = 16

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
    One memo over the whole web: hovering re-renders this component on every wedge
    enter and leave, and none of this geometry can move under a hover. Guarding only
    the point projection left the costlier half — a per-glyph estimate of every
    caption — running on each of those renders.

    The horizontal budget is the caption's own estimated width, the same
    `estimateAxisLabelWidth` the sibling charts use to size a gutter around SVG text
    they cannot measure. A 16-glyph caption runs to ~84px, so a fixed inset let every
    side caption run past the plot; budgeting the radius against the real caption
    width is what keeps them inside the box the svg clips to.
  */
  const { maxValue, radius, points } = useMemo(() => {
    const labelWidth = axes.reduce(
      (max, axis) => Math.max(max, estimateAxisLabelWidth(truncate(axis.label, MAX_LABEL_LENGTH))),
      0
    )
    const webRadius = Math.max(
      0,
      Math.min(width / 2 - labelWidth - LABEL_GAP, height / 2 - LABEL_GUTTER / 2)
    )
    const peak = Math.max(...axes.map((axis) => axis.value), 0)
    return {
      maxValue: peak,
      radius: webRadius,
      points: axes.map((axis, index) => {
        const fraction = peak > 0 ? axis.value / peak : 0
        return {
          axis,
          outer: axisPoint(index, axes.length, webRadius, cx, cy),
          value: axisPoint(index, axes.length, webRadius * fraction, cx, cy),
          label: axisPoint(index, axes.length, webRadius + LABEL_GAP, cx, cy),
        }
      }),
    }
  }, [axes, width, height, cx, cy])

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
      Two boxes, like the siblings: the outer one scrolls, the inner one is the
      positioning context. `relative` on the scroll container itself left the
      absolutely-positioned tooltip anchored to the viewport of the scroll rather than
      to the plot — below CHART_MIN_WIDTH it stayed nailed while the web slid under it.

      Captions are inside the plot by construction, since `radius` is budgeted against
      `labelWidth`, so the horizontal scroll never cuts one off.
    */
    <div ref={containerRef} className='w-full overflow-x-auto overflow-y-hidden'>
      <div className='relative' style={{ width, height }}>
        <svg width={width} height={height} className='overflow-hidden'>
          <defs>
            {/*
              Radial rather than the siblings' vertical linear gradient — a shape with
              radial symmetry lit from the top reads as a rendering error. The stop
              opacities stay in the family's range, and light is the more opaque theme
              because dark composites through `screen` below.
            */}
            <radialGradient id={`radar-${uniqueId}`}>
              <stop offset='0%' stopColor={resolvedColor} stopOpacity={isDark ? 0.32 : 0.45} />
              <stop offset='100%' stopColor={resolvedColor} stopOpacity={isDark ? 0.1 : 0.14} />
            </radialGradient>
          </defs>

          {RING_FRACTIONS.map((fraction) => (
            <polygon
              key={`${uniqueId}-ring-${fraction}`}
              points={polygon(
                axes.map((_, index) => axisPoint(index, axes.length, radius * fraction, cx, cy))
              )}
              fill='none'
              stroke='var(--border)'
              strokeOpacity={fraction === 1 ? 1 : 0.35}
              strokeWidth='1'
            />
          ))}
          {points.map((point, index) => (
            <line
              key={`${uniqueId}-spoke-${point.axis.label}`}
              x1={cx}
              y1={cy}
              x2={point.outer.x}
              y2={point.outer.y}
              stroke='var(--border)'
              strokeOpacity={hoverIndex === index ? 1 : 0.35}
              strokeWidth='1'
            />
          ))}

          <g style={{ mixBlendMode: isDark ? 'screen' : 'normal' }}>
            <polygon
              points={polygon(points.map((point) => point.value))}
              fill={`url(#radar-${uniqueId})`}
              stroke={resolvedColor}
              strokeWidth={isDark ? 1.7 : 2}
              strokeLinejoin='round'
            />
            {points.map((point, index) => (
              <circle
                key={`${uniqueId}-vertex-${point.axis.label}`}
                cx={point.value.x}
                cy={point.value.y}
                r={hoverIndex === index ? 3 : 2}
                fill={resolvedColor}
              />
            ))}
          </g>

          {points.map((point, index) => (
            <text
              key={`${uniqueId}-label-${point.axis.label}`}
              x={point.label.x}
              y={point.label.y}
              /*
                Anchored away from the centre so a caption never crosses the web: the
                left half ends at its x, the right half starts at it, and the two axes
                on the vertical centreline are centred.

                The baseline follows the same logic. `auto` is alphabetic, so glyphs sit
                *above* their anchor — right for the caption at twelve o'clock, but it
                left the one at six o'clock riding ~3px off the ring instead of the
                LABEL_GAP it was given, and it vertically misaligned every caption beside
                the web from its own vertex.
              */
              textAnchor={
                Math.abs(point.label.x - cx) < 1 ? 'middle' : point.label.x > cx ? 'start' : 'end'
              }
              dominantBaseline={
                Math.abs(point.label.x - cx) >= 1
                  ? 'middle'
                  : point.label.y > cy
                    ? 'hanging'
                    : 'auto'
              }
              fontSize={CHART_TICK_FONT_SIZE}
              fill={CHART_TICK_FILL}
            >
              {truncate(point.axis.label, MAX_LABEL_LENGTH)}
            </text>
          ))}

          {/*
            Hit targets last so they sit above the painted web, and wedge-sized — a
            vertex-sized target is far too small to hover on a 200px chart.

            An arc sector, not a triangle. A triangle's far edge is the chord, which
            along its own spoke reaches only `reach·cos(π/n)` — at three axes that is
            50px against a 74px radius, so the largest value's vertex, the one a reader
            aims at, sat outside its own target and outside every other. Sectors tile
            identically and reach `reach` in every direction. The sweep flag is 1
            because SVG's y grows downward, and the arc is never a major one: 2π/n ≤
            2π/3 < π for the three-or-more axes this chart requires.
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
              <path
                key={`${uniqueId}-hit-${point.axis.label}`}
                d={`M ${cx} ${cy} L ${a.x} ${a.y} A ${reach} ${reach} 0 0 1 ${b.x} ${b.y} Z`}
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
              Beside the hovered vertex, through the same placer the siblings use, so
              the box flips and clamps identically. Centring it on the web instead put
              a filled panel over the densest part of the gradient — the concentration
              this chart exists to show. The padding passed is the caption gap rather
              than the axis-bearing charts' gutters: a radar has no axis rules to keep
              clear of.
            */
            const { left, top } = positionChartTooltip({
              anchorX: hovered.value.x,
              anchorY: hovered.value.y,
              width,
              height,
              tooltipMaxWidth: estimateTooltipWidth(
                Math.max(hovered.axis.label.length, value.length)
              ),
              tooltipHeight: estimateTooltipHeight(1, true),
              padding: { top: 0, right: LABEL_GAP, bottom: 0, left: LABEL_GAP },
            })
            return (
              <ChartTooltip left={left} top={top} date={hovered.axis.label}>
                <ChartTooltipRow color={resolvedColor} value={value} />
              </ChartTooltip>
            )
          })()}
      </div>
    </div>
  )
}

export const RadarChart = memo(RadarChartComponent)
