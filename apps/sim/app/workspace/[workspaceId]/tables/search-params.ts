import { parseAsArrayOf, parseAsString } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'

/** Sortable table columns, matching the `Resource.Options` sort menu. */
export const TABLE_SORT_COLUMNS = [
  'name',
  'columns',
  'rows',
  'created',
  'owner',
  'updated',
] as const

/**
 * Shared `sort` + `dir` params for the Tables list. Default sort:
 * most-recently-updated first. Consumed via `useUrlSort` in `tables.tsx`.
 */
export const tablesSortParams = createSortParams(TABLE_SORT_COLUMNS, {
  column: 'updated',
  direction: 'desc',
})

/**
 * Co-located, typed URL query-param definitions for the Tables list.
 *
 * - `search` is the table name filter. The input is controlled directly by the
 *   nuqs value; only its URL write is debounced via `useDebouncedSearchSetter`.
 * - `sort` / `dir` live in {@link tablesSortParams} (shared sort convention).
 * - `rows` filters by row-count bucket; `owner` filters by creator id. Both are
 *   multi-select arrays.
 *
 * Selecting a table navigates to the `tables/[tableId]` route (via `router`),
 * so the active table is route state, not query state, and is intentionally not
 * represented here.
 */
export const tablesParsers = {
  search: parseAsString.withDefault(''),
  rows: parseAsArrayOf(parseAsString).withDefault([]),
  owner: parseAsArrayOf(parseAsString).withDefault([]),
} as const

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const tablesUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
