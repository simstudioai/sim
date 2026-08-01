import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Selectable status filters for the inbox task list. */
export const INBOX_STATUS_FILTERS = [
  'all',
  'completed',
  'processing',
  'received',
  'failed',
  'rejected',
] as const

export type InboxStatusFilter = (typeof INBOX_STATUS_FILTERS)[number]

/**
 * Co-located, typed URL query-param definitions for the inbox task list.
 *
 * - `status` is the active status filter (feeds the tasks query key).
 * - `search` is the subject/sender/body name filter. The input is controlled
 *   directly by the nuqs value; only its URL write is debounced via
 *   `useDebouncedSearchSetter` — never written per keystroke.
 */
export const inboxTaskParsers = {
  status: parseAsStringLiteral(INBOX_STATUS_FILTERS).withDefault('all'),
  search: parseAsString.withDefault(''),
} as const

/** Status/search view-state: clean URLs, no back-stack churn. */
export const inboxTaskUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
