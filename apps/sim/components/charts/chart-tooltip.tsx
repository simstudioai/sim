'use client'

import type { ReactNode } from 'react'
import { CHART_PADDING } from '@/components/charts/chart-geometry'

/**
 * The chart family's hover surface. Defined once so a sibling chart cannot ship a
 * tooltip that looks almost the same — this class string was previously duplicated
 * between the line chart and the status bar.
 */
export const CHART_TOOLTIP_CLASSES =
  'pointer-events-none absolute rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] px-2 py-1.5 text-xs shadow-lg'

interface PositionChartTooltipArgs {
  anchorX: number
  anchorY: number
  width: number
  height: number
  tooltipMaxWidth: number
}

/**
 * Places the tooltip beside the cursor, preferring the right and flipping left when
 * it would overflow, then clamping into the plot band so it never escapes the card.
 */
export function positionChartTooltip({
  anchorX,
  anchorY,
  width,
  height,
  tooltipMaxWidth,
}: PositionChartTooltipArgs): { left: number; top: number } {
  const margin = 10
  const rightEdge = width - CHART_PADDING.right
  const preferRight = anchorX + margin + tooltipMaxWidth <= rightEdge
  const left = preferRight
    ? Math.max(CHART_PADDING.left, Math.min(anchorX + margin, rightEdge - tooltipMaxWidth))
    : Math.max(
        CHART_PADDING.left,
        Math.min(anchorX - margin - tooltipMaxWidth, rightEdge - tooltipMaxWidth)
      )
  const top = Math.min(
    Math.max(anchorY - 26, CHART_PADDING.top),
    height - CHART_PADDING.bottom - 18
  )
  return { left, top }
}

/** Width estimate for the longest `label value` row, used by {@link positionChartTooltip}. */
export function estimateTooltipWidth(longestRowLength: number): number {
  return Math.min(220, Math.max(80, 7 * longestRowLength + 24))
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
      <span className='text-[var(--text-primary)]'>{value}</span>
    </div>
  )
}
