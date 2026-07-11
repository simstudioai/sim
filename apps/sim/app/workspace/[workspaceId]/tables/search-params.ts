import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Sortable table columns, matching the `Resource.Options` sort menu. */
export const TABLE_SORT_COLUMNS = [
  'name',
  'columns',
  'rows',
  'created',
  'owner',
  'updated',
] as const

export type TableSortColumn = (typeof TABLE_SORT_COLUMNS)[number]

const SORT_DIRECTIONS = ['asc', 'desc'] as const

/** Default sort: most-recently-updated first. */
export const DEFAULT_TABLE_SORT_COLUMN: TableSortColumn = 'updated'
export const DEFAULT_TABLE_SORT_DIRECTION = 'desc'

/**
 * Co-located, typed URL query-param definitions for the Tables list.
 *
 * - `search` is the table name filter. The input is controlled directly by the
 *   nuqs value; only its URL write is debounced via `limitUrlUpdates`
 *   (`debounce`) on the setter — never written on every keystroke.
 * - `sort` / `dir` follow the shared sort convention (two scalar params).
 * - `rows` filters by row-count bucket; `owner` filters by creator id. Both are
 *   multi-select arrays.
 *
 * Selecting a table navigates to the `tables/[tableId]` route (via `router`),
 * so the active table is route state, not query state, and is intentionally not
 * represented here.
 */
export const tablesParsers = {
  search: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(TABLE_SORT_COLUMNS).withDefault(DEFAULT_TABLE_SORT_COLUMN),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(DEFAULT_TABLE_SORT_DIRECTION),
  rows: parseAsArrayOf(parseAsString).withDefault([]),
  owner: parseAsArrayOf(parseAsString).withDefault([]),
} as const

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const tablesUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `folderId` scopes the list to a folder and is a navigation destination, not a
 * filter — it lands in browser history so back/forward moves between folders.
 * Kept as a standalone `useQueryState` (via {@link tableFolderIdParam}) rather
 * than folded into {@link tablesParsers}, since that group's shared options are
 * `history: 'replace'`.
 */
export const tableFolderIdParam = {
  key: 'folderId',
  parser: parseAsString,
} as const

export const tableFolderIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
