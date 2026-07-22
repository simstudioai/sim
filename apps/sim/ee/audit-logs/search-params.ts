import { parseAsArrayOf, parseAsString } from 'nuqs/server'
import {
  parseAsDateString,
  parseAsTimeRange,
} from '@/app/workspace/[workspaceId]/logs/search-params'
import type { TimeRange } from '@/stores/logs/filters/types'

export const DEFAULT_AUDIT_TIME_RANGE: TimeRange = 'Past 30 days'

/**
 * Co-located, typed URL query-param definitions for the enterprise audit-logs
 * settings section. `timeRange` reuses the logs feature's kebab-token parser so
 * both surfaces share one wire format for time windows.
 *
 * `startDate`/`endDate` are deliberately nullable (no `.withDefault`) — they are
 * only populated when `timeRange` is "Custom range"; for every preset range the
 * window is derived from the range label, so a default would be meaningless.
 * The search box binds to the shared settings `?search=` param via
 * `useSettingsSearch`, not this map.
 */
export const auditLogFilterParsers = {
  types: parseAsArrayOf(parseAsString).withDefault([]),
  timeRange: parseAsTimeRange.withDefault(DEFAULT_AUDIT_TIME_RANGE),
  startDate: parseAsDateString,
  endDate: parseAsDateString,
} as const

/** Filter view-state: clean URLs, no back-stack churn, kebab-case URL keys. */
export const auditLogFilterUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
  urlKeys: {
    timeRange: 'time-range',
    startDate: 'start-date',
    endDate: 'end-date',
  },
} as const
