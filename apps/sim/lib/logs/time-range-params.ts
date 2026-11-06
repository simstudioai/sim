import { createParser } from 'nuqs/server'
import type { TimeRange } from '@/stores/logs/filters/types'

/** Maps a {@link TimeRange} label to its stable URL token and back. */
const TIME_RANGE_TO_TOKEN: Record<TimeRange, string> = {
  'All time': 'all-time',
  'Past 30 minutes': 'past-30-minutes',
  'Past hour': 'past-hour',
  'Past 6 hours': 'past-6-hours',
  'Past 12 hours': 'past-12-hours',
  'Past 24 hours': 'past-24-hours',
  'Past 3 days': 'past-3-days',
  'Past 7 days': 'past-7-days',
  'Past 14 days': 'past-14-days',
  'Past 30 days': 'past-30-days',
  'Custom range': 'custom',
}

const TOKEN_TO_TIME_RANGE: Record<string, TimeRange> = Object.fromEntries(
  Object.entries(TIME_RANGE_TO_TOKEN).map(([label, token]) => [token, label as TimeRange])
) as Record<string, TimeRange>

/**
 * Parser for the `timeRange` param. Serializes labels to kebab tokens. Unknown
 * tokens parse to `null` so each consuming surface's `.withDefault(...)` decides
 * the fallback (logs: "All time"; audit-logs: "Past 30 days").
 */
export const parseAsTimeRange = createParser<TimeRange>({
  parse(value) {
    return TOKEN_TO_TIME_RANGE[value] ?? null
  },
  serialize(value) {
    return TIME_RANGE_TO_TOKEN[value] ?? 'all-time'
  },
})
