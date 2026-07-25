import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { SORT_DIRECTIONS } from '@/lib/url-state'

/** Default sort direction applied when a sort column is selected. */
export const DEFAULT_TABLE_DETAIL_SORT_DIRECTION = 'asc'

/**
 * Co-located, typed URL query-param definitions for the table-detail view.
 *
 * - `sort` is the active sort column. Columns are user-defined table columns
 *   (not a fixed set), so the column id is stored as a free-form string. A
 *   `null` value means "no active sort" — the table's natural row order — and
 *   clears from the URL.
 * - `dir` is the sort direction, following the shared `sort`+`dir` convention.
 *
 * The in-grid `filter` is intentionally NOT represented here. `Filter` is a
 * recursive, arbitrarily-nested object (`$or`/`$and` combinators, per-column
 * operator objects); serializing it would put a large structured blob in the
 * URL, which the URL-state doctrine forbids. It stays in local `useState`.
 */
export const tableDetailParsers = {
  sort: parseAsString,
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(DEFAULT_TABLE_DETAIL_SORT_DIRECTION),
  /**
   * Active saved view id. Nullable with no default: `null` is the built-in "All"
   * state (no view), which is behaviourally distinct from any saved view and is
   * what a table with zero views always shows.
   *
   * Only the id lives here — the view's filter/sort/layout are looked up from the
   * loaded list, per the store-the-id-derive-the-object convention. A table's
   * default view is resolved on mount and written back explicitly, so a shared
   * link keeps pointing at the same view even if someone changes the default.
   */
  view: parseAsString,
} as const

/**
 * Sort + view state: clean URLs, no back-stack churn.
 *
 * The wire key is `table-view`, not `view` — these parsers also bind to the home
 * surface via the embedded mothership table, where a bare `view` would collide
 * with any future view-mode param there.
 */
export const tableDetailUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
  urlKeys: { view: 'table-view' },
} as const
