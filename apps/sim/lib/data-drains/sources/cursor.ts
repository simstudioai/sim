import { type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Cursor } from '@/lib/data-drains/types'

/**
 * Composite cursor for time-ordered tables. Pairs a timestamp with the row's id
 * so chunks split across rows that share a timestamp pick up cleanly without
 * skipping or duplicating.
 */
export interface TimeCursor {
  ts: string
  id: string
}

export function encodeTimeCursor(value: TimeCursor): Cursor {
  return JSON.stringify(value)
}

export function decodeTimeCursor(cursor: Cursor): TimeCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(cursor) as TimeCursor
    if (typeof parsed?.ts !== 'string' || typeof parsed?.id !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Builds a strict-greater-than predicate over a `(timestampCol, idCol)` pair.
 *
 * Postgres `timestamp` columns store microsecond precision but JS `Date`
 * round-trips at millisecond precision, so the cursor only ever captures
 * millisecond-truncated timestamps. We compare in millisecond buckets via
 * `date_trunc('milliseconds', col)` so the predicate's notion of order matches
 * `timeCursorOrderBy` exactly. If ORDER BY used raw microseconds while the
 * predicate used millisecond buckets, a row sorted later by µs but with a
 * lexicographically earlier id than the cursor row would be skipped forever.
 */
export function timeCursorPredicate(
  timestampCol: PgColumn,
  idCol: PgColumn,
  cursor: TimeCursor | null
): SQL | undefined {
  if (!cursor) return undefined
  return sql`(date_trunc('milliseconds', ${timestampCol}), ${idCol}) > (${new Date(cursor.ts)}, ${cursor.id})`
}

/**
 * ORDER BY fragments paired with `timeCursorPredicate`. Both must agree on
 * millisecond bucketing so cursor advancement never skips rows.
 */
export function timeCursorOrderBy(timestampCol: PgColumn, idCol: PgColumn): [SQL, SQL] {
  return [sql`date_trunc('milliseconds', ${timestampCol}) asc`, sql`${idCol} asc`]
}
