import { formatDuration } from '@sim/utils/formatting'

/** Duration for an axis tick or tooltip. `—` for a missing or non-positive value. */
export function formatChartLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return formatDuration(ms, { precision: 2 }) ?? '—'
}

/** The tooltip's header line: `MAR 4 3:05 PM`. Empty for an unparseable timestamp. */
export function formatChartTimestamp(timestamp?: string, timeZone?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
  return `${formatChartDate(timestamp, timeZone)} ${time}`
}

/** The tooltip's header line for a calendar bucket: `MAR 4`. Empty for an unparseable timestamp. */
export function formatChartDate(timestamp?: string, timeZone?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date
    .toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })
    .toUpperCase()
}

/** Compact axis magnitude — `1.2k`, `3.4m`. */
export function formatChartCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    .format(value)
    .toLowerCase()
}
