import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Selectable resource-type tabs in the Recently Deleted view. */
export const RECENTLY_DELETED_TABS = [
  'all',
  'workflow',
  'folder',
  'table',
  'knowledge',
  'file',
] as const

export type RecentlyDeletedTab = (typeof RECENTLY_DELETED_TABS)[number]

/** Sortable columns for the deleted-items list. */
export const RECENTLY_DELETED_SORT_COLUMNS = ['deleted', 'name', 'type'] as const

export type RecentlyDeletedSortColumn = (typeof RECENTLY_DELETED_SORT_COLUMNS)[number]

const SORT_DIRECTIONS = ['asc', 'desc'] as const

/** Default sort: most-recently-deleted first. */
export const DEFAULT_RECENTLY_DELETED_SORT_COLUMN: RecentlyDeletedSortColumn = 'deleted'
export const DEFAULT_RECENTLY_DELETED_SORT_DIRECTION = 'desc'

/**
 * Co-located, typed URL query-param definitions for the Recently Deleted
 * settings view.
 *
 * - `tab` is the active resource-type filter.
 * - `sort` / `dir` follow the shared sort convention.
 * - `search` is the name filter. The input is controlled directly by the nuqs
 *   value; only its URL write is debounced via `limitUrlUpdates` (`debounce`) on
 *   the setter — never written on every keystroke.
 */
export const recentlyDeletedParsers = {
  tab: parseAsStringLiteral(RECENTLY_DELETED_TABS).withDefault('all'),
  sort: parseAsStringLiteral(RECENTLY_DELETED_SORT_COLUMNS).withDefault(
    DEFAULT_RECENTLY_DELETED_SORT_COLUMN
  ),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(DEFAULT_RECENTLY_DELETED_SORT_DIRECTION),
  search: parseAsString.withDefault(''),
} as const

/** Tab/filter/sort view-state: clean URLs, no back-stack churn. */
export const recentlyDeletedUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
