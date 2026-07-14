import { createParser, parseAsString, parseAsStringLiteral } from 'nuqs/server'

const CALENDAR_SCOPES = ['day', 'week', 'month'] as const

/** Default calendar granularity; matches the prior `useState` initial scope. */
export const DEFAULT_CALENDAR_SCOPE = 'week'

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Local-time date-only parser (`yyyy-MM-dd`).
 *
 * Unlike nuqs's built-in `parseAsIsoDate` — which serializes via `toISOString()`
 * and parses to **UTC** midnight — this reads and writes the date using the
 * browser's **local** calendar fields. The calendar's `anchor` is a local-time
 * `Date` (`zonedClockDate`) and all the grid math (`date-fns`) is local, so a
 * UTC-based parser shifts the day by ±1 in any non-UTC timezone on
 * reload/deep-link/back-forward. This local parser round-trips losslessly against
 * that local-time math.
 */
const parseAsLocalDate = createParser<Date>({
  parse(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isNaN(date.getTime()) ? null : date
  },
  serialize(value) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
  },
  eq(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    )
  },
})

/**
 * Co-located, typed URL query-param definitions for the scheduled-tasks calendar.
 *
 * - `scope` is the calendar granularity (`day` / `week` / `month`).
 * - `anchor` is the focused day, stored date-only (`yyyy-MM-dd`) via the
 *   local-time {@link parseAsLocalDate} so it matches the calendar's local-time
 *   date math (no timezone day-shift). It is intentionally **nullable** (no
 *   `.withDefault`): the default anchor is "today", which is dynamic and resolved
 *   per-timezone in the hook (`anchor = param ?? zonedClockDate(now, tz)`). A
 *   clean URL therefore means "today", and navigating back to today clears the
 *   param.
 */
export const calendarParsers = {
  scope: parseAsStringLiteral(CALENDAR_SCOPES).withDefault(DEFAULT_CALENDAR_SCOPE),
  anchor: parseAsLocalDate,
} as const

/** Calendar view-state: clean URLs, no back-stack churn. */
export const calendarUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * The open task occurrence's id (`?taskId=`). The value is the occurrence id
 * from `scheduleToTasks`: `scheduleId` (one-time), `scheduleId:<runAt ISO>`
 * (recurring occurrence), or `scheduleId:last` (last-run marker). Nullable —
 * a clean URL means no task modal is open.
 */
export const taskIdParam = {
  key: 'taskId',
  parser: parseAsString,
} as const

/** Opening a task is a destination — Back closes it. */
export const taskIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
