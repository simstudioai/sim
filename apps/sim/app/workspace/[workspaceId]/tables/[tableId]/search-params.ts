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
} as const

/** Sort view-state: clean URLs, no back-stack churn. */
export const tableDetailUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
