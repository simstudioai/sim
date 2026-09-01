import { formatDuration } from '@sim/utils/formatting'
import { format } from 'date-fns'

/**
 * Value and tick formatting shared by the chart family.
 *
 * These live here rather than in the logs feature's `utils.ts` because that module
 * imports the block registry, and a chart that reached for it would drag the whole
 * executable registry into every consumer's bundle.
 */

/** Duration for an axis tick or tooltip. `—` for a missing or non-positive value. */
export function formatChartLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return formatDuration(ms, { precision: 2 }) ?? '—'
}

/** The tooltip's header line: `MAR 4 3:05 PM`. Empty for an unparseable timestamp. */
export function formatChartTimestamp(timestamp?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return `${format(date, 'MMM d').toUpperCase()} ${format(date, 'h:mm a')}`
}

/** Compact axis magnitude — `1.2k`, `3.4m`. */
export function formatChartCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    .format(value)
    .toLowerCase()
}
