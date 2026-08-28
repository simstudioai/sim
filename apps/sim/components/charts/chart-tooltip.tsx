'use client'

import type { ReactNode } from 'react'
import { CHART_PADDING, type ChartPadding } from '@/components/charts/chart-geometry'

/**
 * The chart family's hover surface. Defined once so a sibling chart cannot ship a
 * tooltip that looks almost the same — this class string was previously duplicated
 * between the line chart and the status bar.
 */
export const CHART_TOOLTIP_CLASSES =
  'pointer-events-none absolute rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs shadow-overlay'

interface PositionChartTooltipArgs {
  anchorX: number
  anchorY: number
  width: number
  height: number
  tooltipMaxWidth: number
  tooltipHeight: number
  /** The chart's resolved padding, whose left gutter varies with its axis labels. */
  padding?: ChartPadding
}

/**
 * Places the tooltip beside the cursor, preferring the right and flipping left when
 * it would overflow, then clamping it wholly inside the chart box.
 *
 * The vertical clamp is against the tooltip's own height rather than a fixed inset.
 * A fixed one let the box hang a pixel or two past the bottom near the foot of the
 * plot, and because the scroll container's `overflow-x` forces `overflow-y` to `auto`,
 * those pixels raised a vertical scrollbar the moment the cursor approached the axis.
 */
export function positionChartTooltip({
  anchorX,
  anchorY,
  width,
  height,
  tooltipMaxWidth,
  tooltipHeight,
  padding = CHART_PADDING,
}: PositionChartTooltipArgs): { left: number; top: number } {
  const margin = 10
  const rightEdge = width - padding.right
  const preferRight = anchorX + margin + tooltipMaxWidth <= rightEdge
  const left = preferRight
    ? Math.max(padding.left, Math.min(anchorX + margin, rightEdge - tooltipMaxWidth))
    : Math.max(
        padding.left,
        Math.min(anchorX - margin - tooltipMaxWidth, rightEdge - tooltipMaxWidth)
      )
  const top = Math.max(0, Math.min(anchorY - 26, height - tooltipHeight))
  return { left, top }
}

/** Width estimate for the longest `label value` row, used by {@link positionChartTooltip}. */
export function estimateTooltipWidth(longestRowLength: number): number {
  return Math.min(220, Math.max(80, 7 * longestRowLength + 24))
}

/** Border plus the `py-1.5` the tooltip's own class string sets. */
const TOOLTIP_CHROME_HEIGHT = 2 + 12

/**
 * The `text-micro` date's line box plus its `mb-1`.
 *
 * The type scale pairs no line-height with a font size, so a line occupies the
 * ambient 1.5 rather than the font size itself — 15px for 10px `text-micro`, not 10.
 */
const TOOLTIP_DATE_HEIGHT = 15 + 4

/** One `text-xs` row's line box: 11px at the ambient 1.5, rounded up from 16.5. */
const TOOLTIP_ROW_HEIGHT = 17

/**
 * Height of the box {@link ChartTooltip} renders, from its own box model.
 *
 * Estimated rather than measured because the position is computed in the same render
 * that mounts the tooltip — reading a real height would need a second paint, which
 * shows up as the tooltip visibly jumping under the cursor. Every part rounds up:
 * this is what {@link positionChartTooltip} clamps against and the chart clips its
 * overflow, so an underestimate cuts the bottom off the box rather than moving it.
 */
export function estimateTooltipHeight(rowCount: number, hasDate: boolean): number {
  return (
    TOOLTIP_CHROME_HEIGHT +
    (hasDate ? TOOLTIP_DATE_HEIGHT : 0) +
    Math.max(1, rowCount) * TOOLTIP_ROW_HEIGHT
  )
}

interface ChartTooltipProps {
  left: number
  top: number
  /** Header line; omitted when the timestamp could not be formatted. */
  date?: string
  children: ReactNode
}

export function ChartTooltip({ left, top, date, children }: ChartTooltipProps) {
  return (
    <div className={CHART_TOOLTIP_CLASSES} style={{ left, top }}>
      {date && <div className='mb-1 text-[var(--text-tertiary)] text-micro'>{date}</div>}
      {children}
    </div>
  )
}

interface ChartTooltipRowProps {
  color: string
  label?: string
  value: string
}

export function ChartTooltipRow({ color, label, value }: ChartTooltipRowProps) {
  return (
    <div className='flex items-center gap-2'>
      <span
        aria-hidden='true'
        className='inline-block size-[6px] rounded-xs'
        style={{ backgroundColor: color }}
      />
      {label && <span className='text-[var(--text-secondary)]'>{label}</span>}
      <span className='text-[var(--text-body)]'>{value}</span>
    </div>
  )
}
