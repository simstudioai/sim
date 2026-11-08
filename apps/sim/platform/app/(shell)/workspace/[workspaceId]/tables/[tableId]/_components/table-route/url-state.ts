import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { SORT_DIRECTIONS } from '@/platform/lib/data/tables'

/** The direction a newly sorted column takes, which a clean URL implies. */
export const DEFAULT_TABLE_SORT_DIRECTION = 'asc'

/**
 * The grid's single-column sort, in the URL as legacy keeps it (`sort` and `dir`). Columns are the
 * table's own, so the column is a free-form id; `null` is the table's natural order. The filter is a
 * nested predicate and Find is a viewport cursor, so neither belongs in the URL.
 */
export const tableDetailParsers = {
  sort: parseAsString,
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(DEFAULT_TABLE_SORT_DIRECTION),
} as const

/** Clean URLs, no back-stack churn for a sort change. */
export const tableDetailUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
