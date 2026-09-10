export const SEARCH_STATS_PERIODS = ['today', '3d', '7d', '14d', '30d', '90d', 'custom'] as const
export const SEARCH_STATS_SURFACES = [
  'dashboard',
  'copilot',
  'mcp',
  'slack',
  'api',
  'workflow',
  'other',
] as const
export const SEARCH_STATS_MAX_DAYS = 90
const DAY_MS = 86_400_000

export const SEARCH_STATS_PEOPLE_LIMIT = 20
export const SEARCH_STATS_SOURCE_LIMIT = 100

export const SEARCH_STATS_SURFACE_LABELS: Record<(typeof SEARCH_STATS_SURFACES)[number], string> = {
  dashboard: 'Search',
  copilot: 'Assistant',
  mcp: 'MCP',
  slack: 'Slack',
  api: 'API',
  workflow: 'Workflows',
  other: 'Other',
}

export interface SearchStatsDateRange {
  startDate?: string
  endDate?: string
}

/** Checks the date-only UTC range shared by the picker, API, and aggregate query. */
export function getSearchStatsRangeError(
  range: SearchStatsDateRange,
  now = new Date()
): string | null {
  const { startDate, endDate } = range
  if (!startDate || !endDate) return 'Select both a start date and an end date.'
  for (const date of [startDate, endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Use dates in YYYY-MM-DD format.'
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return 'Select valid calendar dates.'
    }
  }
  if (endDate < startDate) return 'The end date must be on or after the start date.'
  if (endDate > now.toISOString().slice(0, 10)) return 'Select dates on or before today (UTC).'
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1
  if (days > SEARCH_STATS_MAX_DAYS)
    return `Select a range of ${SEARCH_STATS_MAX_DAYS} days or fewer.`
  return null
}

/** Daily UTC buckets, with the selected end date included and today capped at the current time. */
export function getSearchStatsWindow(
  period: (typeof SEARCH_STATS_PERIODS)[number],
  now = new Date(),
  range: SearchStatsDateRange = {}
) {
  if (period === 'custom') {
    const error = getSearchStatsRangeError(range, now)
    if (error) throw new Error(error)
    const start = new Date(`${range.startDate}T00:00:00.000Z`)
    const endDay = new Date(`${range.endDate}T00:00:00.000Z`)
    const end = new Date(Math.min(endDay.getTime() + DAY_MS, now.getTime()))
    const days = (endDay.getTime() - start.getTime()) / DAY_MS + 1
    return { start, end, days }
  }
  const daysByPeriod = { today: 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30, '90d': 90 } as const
  const days = daysByPeriod[period]
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { start, end: now, days }
}
