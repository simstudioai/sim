'use client'

import { memo, useId, useMemo, useState } from 'react'
import {
  CHART_GRID_FRACTIONS,
  CHART_TICK_FILL,
  CHART_TICK_FONT_SIZE,
  ChartTooltip,
  ChartTooltipRow,
  estimateAxisLabelWidth,
  estimateTooltipHeight,
  estimateTooltipWidth,
  positionChartTooltip,
  useChartWidth,
  useIsDarkTheme,
} from '@sim/emcn'
import { truncate } from '@sim/utils/string'

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

/** Cap captions to prevent overflow; tooltips retain the full label. */
const MAX_LABEL_LENGTH = 16

/** Start at twelve o’clock so categories follow clockwise in list order. */
function axisPoint(index: number, count: number, radius: number, cx: number, cy: number) {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
}

function polygon(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

/** Compares category values on a shared radial scale normalized to the largest value. */
function RadarChartComponent({ axes, color, height = 200 }: RadarChartProps) {
  const uniqueId = useId().replace(/:/g, '')
  const [containerRef, containerWidth] = useChartWidth()
  const isDark = useIsDarkTheme()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const width = containerWidth ?? 0
  const cx = width / 2
  const cy = height / 2
  /** Reserve caption width and reuse geometry during hover updates. */
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

  /**
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
    /** Anchor tooltips to the plot so they scroll with it. */
    <div ref={containerRef} className='w-full overflow-x-auto overflow-y-hidden'>
      <div className='relative' style={{ width, height }}>
        <svg width={width} height={height} className='overflow-hidden'>
          <defs>
            <radialGradient id={`radar-${uniqueId}`}>
              <stop offset='0%' stopColor={color} stopOpacity={isDark ? 0.32 : 0.45} />
              <stop offset='100%' stopColor={color} stopOpacity={isDark ? 0.1 : 0.14} />
            </radialGradient>
          </defs>

          {[...CHART_GRID_FRACTIONS, 1].map((fraction) => (
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
              stroke={color}
              strokeWidth={isDark ? 1.7 : 2}
              strokeLinejoin='round'
            />
            {points.map((point, index) => (
              <circle
                key={`${uniqueId}-vertex-${point.axis.label}`}
                cx={point.value.x}
                cy={point.value.y}
                r={hoverIndex === index ? 3 : 2}
                fill={color}
              />
            ))}
          </g>

          {points.map((point) => (
            <text
              key={`${uniqueId}-label-${point.axis.label}`}
              x={point.label.x}
              y={point.label.y}
              /** Anchor captions outward; vertical alignment must preserve the caption gap. */
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

          {/** Arc sectors cover the outer vertices; triangular targets leave gaps at low axis counts. */}
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
            /** Place tooltips beside the vertex, using caption clearance instead of axis gutters. */
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
                <ChartTooltipRow color={color} value={value} />
              </ChartTooltip>
            )
          })()}
      </div>
    </div>
  )
}

export const RadarChart = memo(RadarChartComponent)
