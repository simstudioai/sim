import {
  and,
  asc,
  type Column,
  desc,
  eq,
  gt,
  ilike,
  lt,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const LIST_SORT_ORDERS = ['asc', 'desc'] as const
export type ListSortOrder = (typeof LIST_SORT_ORDERS)[number]

/**
 * Runtime half of the v2 list convention declared in
 * `lib/api/contracts/v2/shared.ts`: turns a validated `search` term and a
 * validated `sortBy`/`sortOrder` pair into SQL.
 *
 * Nothing here accepts a caller string as SQL. `search` becomes a bound ILIKE
 * parameter, a sort is only ever expressed as one of the keys the resource
 * itself listed (the contract enum is what makes that lookup total), and a
 * cursor's values are type-checked against their key before they are bound.
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

/** Caller-facing message for a cursor that cannot be resumed under the requested sort. */
export const INVALID_CURSOR_MESSAGE =
  'cursor does not match the requested sortBy/sortOrder. Restart pagination without a cursor after changing the sort.'

/**
 * One column of a keyset ordering, with the codec that moves its value through
 * the opaque cursor.
 *
 * `bind` returning `null` is how a malformed cursor becomes a 400. The values
 * inside a cursor are caller-controlled, so "the sort stamp and key count
 * match" is not enough — a non-numeric `size` or an unparseable timestamp has
 * to be rejected at the boundary instead of reaching the query as `NaN` or an
 * `Invalid Date`, which surfaces as a 500.
 */
export interface KeysetKey<Row> {
  /** The expression this key both orders and compares on. */
  expr: SQLWrapper
  /** This key's cursor value for `row`. */
  encode: (row: Row) => CursorKey
  /** The cursor value as bindable SQL, or `null` when this key cannot hold it. */
  bind: (value: CursorKey) => SQL | null
}

/** A text key — names, titles, ids. */
export function textKey<Row>(column: Column, read: (row: Row) => string): KeysetKey<Row> {
  return {
    expr: column,
    encode: read,
    bind: (value) => (typeof value === 'string' ? sql`${value}` : null),
  }
}

/** A numeric key — sizes, counts, manual positions. */
export function numberKey<Row>(column: SQLWrapper, read: (row: Row) => number): KeysetKey<Row> {
  return {
    expr: column,
    encode: read,
    bind: (value) => (typeof value === 'number' && Number.isFinite(value) ? sql`${value}` : null),
  }
}

/**
 * The spellings of a Postgres `numeric` literal a cursor may carry back.
 *
 * Deliberately narrower than what `numeric` accepts: `NaN`, `Infinity`, and
 * exponent forms all parse as `numeric` but compare in ways a keyset cannot
 * order totally, and a cursor value is caller-controlled.
 */
const DECIMAL_CURSOR_PATTERN = /^-?\d+(\.\d+)?$/

/**
 * An arbitrary-precision key — a `numeric`/`decimal` column, carried through the
 * cursor as the digit string Postgres returned.
 *
 * Never through a JS number. `numeric` is unconstrained, so two rows can differ
 * in a place float64 cannot represent; narrowing the anchor to a double and
 * comparing it back against full-precision `numeric` collapses those rows onto
 * one anchor, and the page boundary then skips or repeats them.
 *
 * The bound value carries an explicit `::numeric` cast for the same reason
 * {@link timestampKey} casts: a bare placeholder arrives as `unknown`, and while
 * that infers fine against a bare column, these expressions are wrapped in
 * `COALESCE`, whose result type must be resolvable from its arguments.
 */
export function decimalKey<Row>(column: SQLWrapper, read: (row: Row) => string): KeysetKey<Row> {
  return {
    expr: column,
    encode: read,
    bind: (value) =>
      typeof value === 'string' && DECIMAL_CURSOR_PATTERN.test(value)
        ? sql`cast(${value} as numeric)`
        : null,
  }
}

/**
 * A timestamp key, ordered and compared at millisecond precision.
 *
 * Postgres keeps microseconds and `defaultNow()` populates them, but a cursor
 * value round-trips through a JS `Date`, which cannot represent them. Ordering
 * on the raw column while comparing against a truncated cursor value re-admits
 * the page's own last row — `stored > truncated` is true for it — which
 * duplicates that row and stalls pagination outright at a page size of one.
 * Truncating both sides makes the SQL ordering exactly the ordering a cursor
 * can express, so the `id` tiebreaker is what actually separates rows inside a
 * millisecond.
 *
 * `date_trunc` rules out an index-ordered scan, but none of the timestamp
 * columns sorted here are indexed, so it costs nothing today. Adding an index
 * to serve one of these sorts means indexing this same expression.
 *
 * The column serializes the `Date` (drizzle's own timestamp encoder) and also
 * supplies the cast. A bare placeholder arrives as `unknown` and `date_trunc` is
 * overloaded (`timestamp`, `timestamptz`, `interval`), so it resolves to no
 * overload and 500s on page two — this is the only key whose placeholder sits
 * inside a function rather than against a typed column. Taking the type from the
 * column rather than a literal keeps a `timestamptz` correct, and reading it
 * inside `bind` keeps the module-scope sort maps from touching the column at
 * import time.
 */
export function timestampKey<Row>(column: Column, read: (row: Row) => Date): KeysetKey<Row> {
  return {
    expr: sql`date_trunc('milliseconds', ${column})`,
    encode: (row) => read(row).toISOString(),
    bind: (value) => {
      if (typeof value !== 'string') return null
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return null
      return sql`date_trunc('milliseconds', cast(${sql.param(date, column)} as ${sql.raw(column.getSQLType())}))`
    },
  }
}

export function sortDirection(order: ListSortOrder): typeof asc {
  return order === 'asc' ? asc : desc
}

/**
 * `ORDER BY` for an ordered key list, every key taking the requested direction.
 * On a paginated list these are the keyset's keys; on a single-page list they
 * are just the sort plus its tiebreaker.
 */
export function listOrderBy(keys: readonly SQLWrapper[], order: ListSortOrder): SQL[] {
  const direction = sortDirection(order)
  return keys.map((key) => direction(key))
}

/** The `expr` of each keyset key, for `ORDER BY`. */
export function keysetColumns<Row>(keys: readonly KeysetKey<Row>[]): SQLWrapper[] {
  return keys.map((key) => key.expr)
}

/** The cursor values for `row`, in key order. */
export function encodeKeyset<Row>(keys: readonly KeysetKey<Row>[], row: Row): CursorKey[] {
  return keys.map((key) => key.encode(row))
}

/**
 * The `WHERE` fragment that resumes a page, or `undefined` for page one.
 *
 * Wraps {@link keysetAfter}'s `null` — a cursor that does not fit this sort — in
 * the canonical validation failure, so every keyset list renders a bad cursor as
 * the same 400 instead of each deciding for itself. A cursor is caller-supplied,
 * so the one outcome that must never happen is it reaching the query and
 * surfacing as a 500.
 */
export function resumeKeyset<Row>(
  keys: readonly KeysetKey<Row>[],
  cursorKeys: CursorKey[] | undefined,
  order: ListSortOrder
): SQL | undefined {
  if (!cursorKeys) return undefined
  const after = keysetAfter(keys, cursorKeys, order)
  if (after === null) throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  return after
}

/** One page of a keyset list, plus the keys that resume it. */
export interface KeysetPage<Row> {
  data: Row[]
  nextCursorKeys: CursorKey[] | null
}

/**
 * Cuts an over-fetched row set down to the requested page.
 *
 * Pair with `.limit(limit + 1)`: the extra row is how "is there a next page"
 * is answered without a second count query. Writing the `rows.length > limit`
 * comparison out per resource is how an off-by-one becomes a page that repeats
 * its last row, so it lives here once.
 *
 * `limit` is optional because several of these readers are also called by
 * unpaged internal surfaces that want the whole set; an absent `limit` means no
 * `LIMIT` clause was applied, and such a read can never carry a cursor.
 */
export function keysetPage<Row>(
  keys: readonly KeysetKey<Row>[],
  rows: Row[],
  limit: number | undefined
): KeysetPage<Row> {
  if (limit === undefined) return { data: rows, nextCursorKeys: null }
  const hasMore = rows.length > limit
  const data = rows.slice(0, limit)
  const last = data.at(-1)
  return { data, nextCursorKeys: hasMore && last ? encodeKeyset(keys, last) : null }
}

/**
 * The `WHERE` half of the keyset: strictly after `values` in the requested
 * direction, expanded lexicographically so ties on a leading key fall through
 * to the next one.
 *
 * Returns `null` when the cursor does not fit this sort — wrong number of keys,
 * or a value the key cannot hold. Callers render that as a 400 rather than
 * paging from a nonsense position.
 */
export function keysetAfter<Row>(
  keys: readonly KeysetKey<Row>[],
  values: CursorKey[],
  order: ListSortOrder
): SQL | null {
  if (values.length !== keys.length) return null

  const bound: SQL[] = []
  for (const [i, key] of keys.entries()) {
    const value = key.bind(values[i])
    if (value === null) return null
    bound.push(value)
  }

  const beyond = order === 'asc' ? gt : lt
  const clauses = keys.map((key, i) =>
    and(...keys.slice(0, i).map((prior, j) => eq(prior.expr, bound[j])), beyond(key.expr, bound[i]))
  )
  return or(...clauses) ?? null
}
