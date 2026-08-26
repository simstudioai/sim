import { type SQL, sql } from 'drizzle-orm'

/**
 * The keyset a sorted log page resumes from: the sort column's value for the
 * last row of the page, plus that row's id as the tiebreaker.
 *
 * `v` is nullable because the sortable columns are — `total_duration_ms` and
 * `cost_total` are null for a run that has not finished — and the ordering puts
 * those rows in a block of their own. See
 * {@link buildLogSortCursorCondition} for how that block is paged.
 */
export interface LogSortCursor {
  v: string | number | null
  id: string
}

export function encodeLogSortCursor(data: LogSortCursor): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

export function decodeLogSortCursor(cursor: string): LogSortCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString())
    if (typeof parsed?.id !== 'string') return null
    return parsed as LogSortCursor
  } catch {
    return null
  }
}

/**
 * The `WHERE` fragment that resumes a page ordered by `<sortExpr> <dir> NULLS
 * LAST, <idCol> <dir>`, or `undefined` for page one.
 *
 * The `OR ${sortExpr} IS NULL` disjunct in the non-null branch is load-bearing
 * and must not be removed as a simplification. Under `NULLS LAST` the
 * null-valued rows form a block strictly after every non-null row, so while the
 * anchor is still non-null they are genuinely "after the cursor" and have to
 * stay in the candidate set. `ORDER BY` plus `LIMIT` is what keeps them off the
 * page until the non-null rows run out, so they are not re-emitted — dropping
 * the disjunct instead makes the null block unreachable forever, because the
 * only way to reach the `v === null` branch below is to have already been handed
 * a null-valued row to anchor on.
 */
export function buildLogSortCursorCondition(
  cursor: LogSortCursor | null,
  sortExpr: unknown,
  idCol: unknown,
  sortOrder: 'asc' | 'desc'
): SQL | undefined {
  if (!cursor) return undefined
  const { v, id } = cursor
  const cmp = sortOrder === 'asc' ? sql`>` : sql`<`
  if (v === null) {
    return sql`(${sortExpr} IS NULL AND ${idCol} ${cmp} ${id})`
  }
  return sql`((${sortExpr} IS NOT NULL AND ${sortExpr} ${cmp} ${v}) OR (${sortExpr} = ${v} AND ${idCol} ${cmp} ${id}) OR ${sortExpr} IS NULL)`
}
