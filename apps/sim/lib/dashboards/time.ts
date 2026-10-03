import { zonedWallClock, zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import type { DashboardRange } from '@/lib/dashboards/spec'

export interface DashboardTimeRange {
  from: string
  to: string
}
const RANGE_MS: Record<DashboardRange, number> = {
  '1h': 3600000,
  '24h': 86400000,
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
  '90d': 90 * 86400000,
}

export function relativeDashboardRange(range: DashboardRange, now: number): DashboardTimeRange {
  return { from: new Date(now - RANGE_MS[range]).toISOString(), to: new Date(now).toISOString() }
}

/** A UTC instant written with or without a trailing `Z`, normalized to ISO. */
export function parseDashboardInstant(value: string): string {
  const normalized = value.endsWith('Z') ? value.slice(0, -1) : value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/.test(normalized))
    throw new Error('Choose a complete start and end date')
  const date = new Date(`${normalized}Z`)
  if (!Number.isFinite(date.getTime()) || !date.toISOString().startsWith(normalized))
    throw new Error('Invalid UTC date and time')
  return date.toISOString()
}

/** URL bounds are instants; legacy offset-free URLs continue to mean UTC. */
export function parseDashboardCustomRange(from: string, to: string): DashboardTimeRange {
  const range = { from: parseDashboardInstant(from), to: parseDashboardInstant(to) }
  if (range.from >= range.to) throw new Error('The start must be earlier than the end')
  return range
}

/** The EMCN calendar closes the selected end minute at :59; SQL uses an exclusive end. */
export function dashboardRangeFromCalendar(
  from: string,
  inclusiveTo: string,
  timeZone = 'UTC'
): DashboardTimeRange {
  const parsed = parseDashboardCustomRange(from, inclusiveTo)
  const convert = (value: string) => {
    const instant = zonedWallClockToUtc(value.slice(0, 19), timeZone)
    if (zonedWallClock(instant, timeZone) !== value.slice(0, 16))
      throw new Error(
        'That local time does not exist because the clocks move forward. Choose another time.'
      )
    const earlier = zonedWallClockToUtc(value.slice(0, 19), timeZone, { ambiguousTime: 'earlier' })
    if (earlier.getTime() !== instant.getTime())
      throw new Error('That local time occurs twice. Switch to UTC to choose an exact time.')
    return instant
  }
  return {
    from: convert(parsed.from).toISOString(),
    to: new Date(convert(parsed.to).getTime() + 1000).toISOString(),
  }
}

export function dashboardZoomRange(
  bounds: unknown,
  range: DashboardTimeRange
): DashboardTimeRange | null {
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 2 ||
    !bounds.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
    return null
  const from = Math.max(Math.round(Math.min(...bounds)), Date.parse(range.from))
  const to = Math.min(Math.round(Math.max(...bounds)), Date.parse(range.to))
  if (to - from < 1000) return null
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}

/** Compact dates for a range; times appear only when it starts and ends on the same day. */
export function dashboardRangeText(range: DashboardTimeRange, timeZone: string): string {
  const from = new Date(range.from)
  const to = new Date(Date.parse(range.to) - 1)
  const fromLocal = zonedWallClock(from, timeZone)
  const toLocal = zonedWallClock(to, timeZone)
  if (fromLocal === toLocal) {
    // Same wall-clock minute (e.g. a DST fall-back repeat): formatRange would collapse both ends,
    // so show each inclusive end exactly, down to milliseconds if seconds still collide.
    const exact = (fractionalSecondDigits?: 3) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits,
        hourCycle: 'h23',
        timeZoneName: 'short',
      })
    const seconds = exact()
    const format = seconds.format(from) === seconds.format(to) ? exact(3) : seconds
    return `${format.format(from)} – ${format.format(to)}`
  }
  const sameDay = fromLocal.slice(0, 10) === toLocal.slice(0, 10)
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: fromLocal.slice(0, 4) === toLocal.slice(0, 4) ? undefined : 'numeric',
    hour: sameDay ? '2-digit' : undefined,
    minute: sameDay ? '2-digit' : undefined,
    hourCycle: 'h23',
  }).formatRange(from, to)
}

export function dashboardTimeLabel(instant: number | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(instant))
}

export function dashboardAxisFormatter(range: DashboardTimeRange, timeZone: string) {
  const duration = Date.parse(range.to) - Date.parse(range.from)
  const date = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' })
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return (value: number) =>
    duration <= 3 * 86400000 ? `${date.format(value)}\n${time.format(value)}` : date.format(value)
}
