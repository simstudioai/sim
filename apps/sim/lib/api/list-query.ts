import { and, asc, type Column, desc, eq, gt, ilike, lt, or, type SQL } from 'drizzle-orm'
import type { V2SortOrder } from '@/lib/api/contracts/v2/shared'

/**
 * Runtime half of the v2 list convention declared in
 * `lib/api/contracts/v2/shared.ts`: turns a validated `search` term and a
 * validated `sortBy`/`sortOrder` pair into SQL.
 *
 * Nothing here accepts a caller string as SQL. `search` becomes a bound ILIKE
 * parameter, and a sort is only ever expressed as one of the {@link Column}
 * objects the resource itself listed — the enum in the contract is what makes
 * the lookup total, so an unknown field is rejected at the boundary and never
 * reaches a query builder.
 */

/**
 * Escapes LIKE/ILIKE wildcards so `%`, `_`, and `\` in a caller's term match
 * themselves. Postgres treats `\` as the default LIKE escape character, so no
 * explicit `ESCAPE` clause is needed.
 *
 * `lib/table/sql.ts` carries its own copy for the JSONB predicate engine; the
 * two are worth folding together, but that module is table-specific and pulls
 * the whole column-type registry with it.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Case-insensitive substring predicate for a v2 `search` term, or `undefined`
 * when the caller did not search (which drops out of an `and(...)`).
 */
export function searchFilter(column: Column, term: string | undefined): SQL | undefined {
  if (term === undefined) return undefined
  return ilike(column, `%${escapeLikePattern(term)}%`)
}

/** A cursor key value, as it survives the base64-JSON round trip. */
export type CursorKey = string | number

/**
 * The keyset behind one sortable field. `keys` is the full ordering, most
 * significant first, and its last entry must be unique within the filtered set
 * (in practice the id) or a page boundary can drop or repeat rows. Every column
 * must be `NOT NULL`: a keyset comparison against a NULL is NULL, which silently
 * truncates the page.
 */
export interface KeysetSort<Row> {
  keys: readonly Column[]
  /** Cursor values for `row`, in `keys` order. */
  encode: (row: Row) => CursorKey[]
  /** Rehydrates cursor values into the column JS types, in `keys` order. */
  decode: (values: CursorKey[]) => unknown[]
}

/** Passing a `Date`-valued column through the cursor as an ISO-8601 string. */
export const cursorDate = {
  encode: (value: Date): string => value.toISOString(),
  decode: (value: CursorKey): Date => new Date(value),
} as const

export function sortDirection(order: V2SortOrder): typeof asc {
  return order === 'asc' ? asc : desc
}

/**
 * `ORDER BY` for an ordered column list, every column taking the requested
 * direction. On a paginated list these are the keyset's keys; on a single-page
 * list they are just the sort plus its tiebreaker.
 */
export function listOrderBy(keys: readonly Column[], order: V2SortOrder): SQL[] {
  const direction = sortDirection(order)
  return keys.map((column) => direction(column))
}

/**
 * The `WHERE` half of the keyset: strictly after `values` in the requested
 * direction, expanded lexicographically so ties on a leading key fall through
 * to the next one.
 */
export function keysetAfter(
  keys: readonly Column[],
  values: unknown[],
  order: V2SortOrder
): SQL | undefined {
  if (values.length !== keys.length) {
    throw new Error(`Keyset cursor carries ${values.length} values for a ${keys.length}-key sort`)
  }
  const beyond = order === 'asc' ? gt : lt
  const clauses = keys.map((column, i) =>
    and(...keys.slice(0, i).map((prior, j) => eq(prior, values[j])), beyond(column, values[i]))
  )
  return or(...clauses)
}
