'use client'

import type { ReactNode } from 'react'
import { CHART_PADDING, type ChartPadding } from '@sim/emcn'

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

/** Flip beside the cursor and clamp the whole tooltip inside the chart. */
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

/** Date line height plus its bottom margin; text inherits a 1.5 line-height. */
const TOOLTIP_DATE_HEIGHT = 15 + 4

/** One `text-xs` row's line box: 11px at the ambient 1.5, rounded up from 16.5. */
const TOOLTIP_ROW_HEIGHT = 17

/** Estimate height before mounting to avoid repositioning; round up to prevent clipping. */
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
