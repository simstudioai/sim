import { parseAsIsoDate, parseAsStringLiteral } from 'nuqs/server'

const CALENDAR_SCOPES = ['day', 'week', 'month'] as const

/** Default calendar granularity; matches the prior `useState` initial scope. */
export const DEFAULT_CALENDAR_SCOPE = 'week'

/**
 * Co-located, typed URL query-param definitions for the scheduled-tasks calendar.
 *
 * - `scope` is the calendar granularity (`day` / `week` / `month`).
 * - `anchor` is the focused day, stored date-only (`yyyy-MM-dd`) via
 *   `parseAsIsoDate`. The calendar grid only reads the anchor's date fields, so a
 *   date-only param round-trips losslessly. It is intentionally **nullable** (no
 *   `.withDefault`): the default anchor is "today", which is dynamic and resolved
 *   per-timezone in the hook (`anchor = param ?? zonedClockDate(now, tz)`). A
 *   clean URL therefore means "today", and navigating back to today clears the
 *   param.
 */
export const calendarParsers = {
  scope: parseAsStringLiteral(CALENDAR_SCOPES).withDefault(DEFAULT_CALENDAR_SCOPE),
  anchor: parseAsIsoDate,
} as const

/** Calendar view-state: clean URLs, no back-stack churn. */
export const calendarUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
