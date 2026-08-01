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
   * Active view, as a tri-state:
   * - absent (`null`) — nothing chosen yet, so the table's default view is adopted
   * - {@link ALL_VIEW_PARAM} — "All" chosen *explicitly*; never overridden by a default
   * - any other value — a saved view id
   *
   * The sentinel exists because clearing the param and explicitly picking "All"
   * would otherwise be the same URL, so a default view would silently reclaim the
   * table on every reload.
   *
   * Only the id lives here — the view's filter/sort/layout are looked up from the
   * loaded list, per the store-the-id-derive-the-object convention. A default view
   * is written back explicitly on adoption, so a shared link keeps resolving to the
   * same view even if someone later changes which one is default.
   */
  view: parseAsString,
} as const

/** Sentinel for an explicit "All" selection. See `tableDetailParsers.view`. */
export const ALL_VIEW_PARAM = 'all'

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
