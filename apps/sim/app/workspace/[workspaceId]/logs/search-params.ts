import { createParser, parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'
import type { LogSortBy } from '@/hooks/queries/logs'
import {
  CORE_TRIGGER_TYPES,
  type LogLevel,
  type TimeRange,
  type TriggerType,
} from '@/stores/logs/filters/types'

/**
 * Co-located, typed URL query-param definitions for the logs feature. The
 * client hook (`useLogFilters`) consumes this typed param definition as the
 * single source of truth.
 *
 * The encoding here intentionally preserves the exact wire format the logs page
 * shipped before nuqs: `timeRange` uses kebab tokens and `level` /
 * `workflowIds` / `folderIds` / `triggers` are comma-joined. `search` carries
 * the raw input value (consumers trim on read).
 */

const DEFAULT_TIME_RANGE: TimeRange = 'All time'

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

const VALID_LEVELS = ['error', 'info', 'running', 'pending'] as const

/**
 * Parser for the `level` param. `level` is a comma-joined list of statuses on
 * the wire but is surfaced as a single `LogLevel` value ("all", a single status,
 * or a comma-joined string) to match the existing store contract.
 */
export const parseAsLogLevel = createParser<LogLevel>({
  parse(value) {
    const levels = value
      .split(',')
      .filter((l): l is (typeof VALID_LEVELS)[number] =>
        (VALID_LEVELS as readonly string[]).includes(l)
      )
    if (levels.length === 0) return 'all'
    if (levels.length === 1) return levels[0]
    return levels.join(',') as LogLevel
  },
  serialize(value) {
    return value
  },
})

const CORE_TRIGGER_SET = new Set<string>(CORE_TRIGGER_TYPES)

/**
 * Parser for the `triggers` param, restricted to known core trigger types.
 * Surfaced as `TriggerType[]` to match the consumer contract — unknown tokens
 * are dropped (mirrors the prior `parseTriggerArrayFromURL` behavior).
 */
export const parseAsTriggers = createParser<TriggerType[]>({
  parse(value) {
    const triggers = value.split(',').filter((t): t is TriggerType => CORE_TRIGGER_SET.has(t))
    return triggers
  },
  serialize(value) {
    return value.join(',')
  },
  eq(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  },
}).withDefault([])

/**
 * The nuqs parser map for every URL-synced logs filter. `clearOnDefault` keeps
 * the URL clean (params drop out when they hold their default value) and
 * `history: 'replace'` matches the prior `history.replaceState` behavior so
 * filter changes don't pollute the browser back stack.
 */
export const logFilterParsers = {
  timeRange: parseAsTimeRange.withDefault(DEFAULT_TIME_RANGE),
  /**
   * Deliberately nullable: only populated when timeRange is "Custom range";
   * every preset range derives its window from the label instead.
   */
  startDate: parseAsString,
  endDate: parseAsString,
  level: parseAsLogLevel.withDefault('all'),
  workflowIds: parseAsArrayOf(parseAsString).withDefault([]),
  folderIds: parseAsArrayOf(parseAsString).withDefault([]),
  triggers: parseAsTriggers,
  search: parseAsString.withDefault(''),
} as const

/** Shared nuqs options for the logs filters: clean URLs, no back-stack churn. */
export const logFilterUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/** Columns the logs list can sort by; must stay in sync with {@link LogSortBy}. */
export const LOG_SORT_COLUMNS = [
  'date',
  'duration',
  'cost',
  'status',
] as const satisfies readonly LogSortBy[]

/**
 * Sort params for the logs resource table (`sort` + `dir`). The defaults match
 * the server's default ordering exactly (newest first), so with
 * `clearOnDefault` a clean URL means "no active sort" and clearing the sort
 * strips both params. Shares {@link logFilterUrlKeys} so sort changes replace
 * history like filter changes.
 */
export const logSortParams = createSortParams(LOG_SORT_COLUMNS, {
  column: 'date',
  direction: 'desc',
})

/**
 * Deep link to a specific execution. On load it resolves to a log row and
 * opens the details sidebar; from then on it is kept in sync with the open
 * run — row click, Enter, the sidebar's next/prev navigation, and closing the
 * panel all write it — so the address bar always matches the open log and the
 * link stays shareable.
 */
export const executionIdParam = {
  key: 'executionId',
  parser: parseAsString,
} as const

/**
 * Options for every `executionId` write. Browsing runs is view-state, not a
 * destination — `replace` keeps rapid row-to-row navigation from flooding the
 * browser back stack.
 */
export const executionIdWriteOptions = { history: 'replace' } as const

const LOG_DETAILS_TABS = ['overview', 'trace'] as const

/**
 * Active tab of the log-details sidebar (`overview` / `trace`). Deep-linkable so
 * a shared link can land on the trace view; `replace` keeps it off the back
 * stack and `clearOnDefault` drops it from the URL when on the default tab.
 */
export const logDetailsTabParam = {
  key: 'tab',
  parser: parseAsStringLiteral(LOG_DETAILS_TABS).withDefault('overview'),
} as const

/** Tab change is view-state, not a destination: replace, clean URL on default. */
export const logDetailsTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
