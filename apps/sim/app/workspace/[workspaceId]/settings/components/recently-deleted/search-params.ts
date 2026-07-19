import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'

/** Selectable resource-type tabs in the Recently Deleted view. */
export const RECENTLY_DELETED_TABS = [
  'all',
  'workflow',
  'folder',
  'interface',
  'table',
  'knowledge',
  'file',
] as const

export type RecentlyDeletedTab = (typeof RECENTLY_DELETED_TABS)[number]

/** Sortable columns for the deleted-items list. */
export const RECENTLY_DELETED_SORT_COLUMNS = ['deleted', 'name', 'type'] as const

/**
 * Shared `sort` + `dir` params for the deleted-items list. Default sort:
 * most-recently-deleted first. Consumed via `useUrlSort` in
 * `recently-deleted.tsx`.
 */
export const recentlyDeletedSortParams = createSortParams(RECENTLY_DELETED_SORT_COLUMNS, {
  column: 'deleted',
  direction: 'desc',
})

/**
 * Co-located, typed URL query-param definitions for the Recently Deleted
 * settings view.
 *
 * - `tab` is the active resource-type filter.
 * - `sort` / `dir` live in {@link recentlyDeletedSortParams} (shared sort
 *   convention).
 * - `search` is the name filter. The input is controlled directly by the nuqs
 *   value; only its URL write is debounced via `useDebouncedSearchSetter`.
 */
export const recentlyDeletedParsers = {
  tab: parseAsStringLiteral(RECENTLY_DELETED_TABS).withDefault('all'),
  search: parseAsString.withDefault(''),
} as const

/** Tab/filter/sort view-state: clean URLs, no back-stack churn. */
export const recentlyDeletedUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
