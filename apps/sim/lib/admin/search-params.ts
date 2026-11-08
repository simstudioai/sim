import { parseAsInteger, parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the Admin user-management
 * view.
 *
 * - `q` is the committed user search query. The visible input keeps its own
 *   local state; only the submitted query lands in the URL (search here is an
 *   explicit submit, not a per-keystroke debounce).
 * - `offset` is the 0-based pagination offset into the admin user list.
 */
export const adminParsers = {
  q: parseAsString.withDefault(''),
  offset: parseAsInteger.withDefault(0),
} as const

/** Search/pagination view-state: clean URLs, no back-stack churn. */
export const adminUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
