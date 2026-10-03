import { createSerializer, parseAsArrayOf, parseAsString } from 'nuqs/server'
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
  /**
   * Nullable by design: the feed is organization-wide unless a link narrows it, and
   * the usage panel's workspace drill-down is what does. Only the id is stored — the
   * name is resolved from the loaded workspace list, so a stale id from an old link
   * clears the filter rather than labelling it with nothing.
   */
  workspace: parseAsString,
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

/**
 * Outbound links into the audit feed — the usage panel's workspace drill-down builds
 * one — serialized from the map the feed itself parses rather than by concatenation,
 * which emitted a bare `?workspace=` for a null id and left the value unencoded.
 */
export const serializeAuditLogFilters = createSerializer(auditLogFilterParsers, {
  clearOnDefault: true,
  urlKeys: auditLogFilterUrlKeys.urlKeys,
})
