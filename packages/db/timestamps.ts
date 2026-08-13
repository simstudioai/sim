/**
 * UTC pinning for `timestamp without time zone` columns.
 *
 * Every timestamp column in `schema.ts` is declared as bare `timestamp(...)`,
 * which is Postgres `timestamp without time zone`: the column stores a naive
 * wall-clock reading with no offset, so the instant it denotes is decided
 * entirely by whoever writes it and whoever reads it. Nothing in the type
 * system pins that decision, and the three writers in this codebase did not
 * agree:
 *
 * - `defaultNow()` / `now()` — Postgres renders the current instant in the
 *   **session's** `TimeZone`, so the stored wall clock is UTC only when the
 *   session happens to be UTC.
 * - drizzle-mapped writes (`updatedAt: new Date()`) — `PgTimestamp`'s
 *   `mapToDriverValue` is `value.toISOString()`, and Postgres **discards** the
 *   trailing `Z` when parsing into a naive column, so the stored wall clock is
 *   always UTC.
 * - a raw `Date` bound through postgres.js — inferred as `timestamptz` (oid
 *   1184) and cast down to the column type in the **session's** `TimeZone`.
 *
 * The read side disagreed the same way: postgres.js parses oid 1114 with
 * `new Date(x)`, and `new Date('2026-08-13 02:44:03.42')` is interpreted in the
 * **Node process's** local zone, while a value postgres.js hands back as a
 * string is interpreted as UTC by drizzle (`value + '+0000'`). So the same
 * column read through two paths yielded instants an offset apart.
 *
 * The compound effect is a timestamp that is a *local* wall clock serialized
 * with `toISOString()` — a `Z`-labelled string naming the wrong instant. It
 * passes every `date-time` format check, so it is silently wrong: it corrupts
 * any sort or range predicate over the field, and can place an `updatedAt`
 * before its own `createdAt`.
 *
 * This module removes the ambiguity at the driver boundary rather than at the
 * call sites, so no future writer can reintroduce it:
 *
 * - {@link UTC_CONNECTION_PARAMETERS} forces every session's `TimeZone` to
 *   `UTC`, so all three write paths store the same wall clock — UTC.
 * - {@link UTC_TIMESTAMP_TYPES} parses oid 1114 as UTC regardless of the Node
 *   process's zone, so every read path recovers that instant exactly.
 *
 * Together they make naive-timestamp round-trips independent of both the
 * database session zone and the process zone. Production already runs both in
 * UTC, so this changes nothing there and makes every other environment behave
 * the way production does.
 *
 * `timestamptz` columns (oid 1184) are deliberately untouched: they already
 * carry an offset on the wire and round-trip correctly on their own.
 */

/** Postgres oid of `timestamp without time zone`. */
const TIMESTAMP_OID = 1114

/**
 * postgres.js startup parameters that pin the session's `TimeZone`.
 *
 * Applied to every client so `now()` and any `timestamptz → timestamp` cast
 * render UTC wall clocks, matching what drizzle's `toISOString()` write already
 * stores.
 */
export const UTC_CONNECTION_PARAMETERS = { TimeZone: 'UTC' } as const

/**
 * postgres.js `types` entry that reads and writes oid 1114 as UTC.
 *
 * `parse` appends the explicit `Z` that the naive wire form omits, which is what
 * makes the recovered instant independent of the process's local zone. `to` is
 * never selected by postgres.js's type inference (a `Date` infers as 1184), so
 * the serializer exists only to keep the entry self-consistent for an explicit
 * `sql.typed` bind.
 *
 * It does not decide the instant for a drizzle read. `drizzle()` registers its
 * own transparent parser over oid 1114 when it wraps a client, replacing this
 * entry, and every client in this repo is wrapped — so on those paths a naive
 * value arrives at drizzle as the raw wire string and `PgTimestamp`'s mapper
 * (`new Date(value + '+0000')`) supplies the UTC reading instead. Both routes
 * yield the same instant, which is why the clobbering is harmless rather than a
 * defect. The entry is kept because it is the only thing pinning the read for a
 * client used as raw postgres.js, and `timestamps.test.ts` asserts the
 * composition of both layers rather than the registration alone.
 */
export const UTC_TIMESTAMP_TYPES = {
  utcTimestamp: {
    to: TIMESTAMP_OID,
    from: [TIMESTAMP_OID],
    serialize: (value: Date | string): string =>
      (value instanceof Date ? value : new Date(value)).toISOString(),
    parse: (value: string): Date => new Date(`${value}Z`),
  },
}

interface PostgresConnectionOptions {
  connection?: Record<string, unknown>
}

/**
 * Applies the UTC pinning to a postgres.js options object.
 *
 * Every client is built through this rather than spreading the two constants by
 * hand, because `connection` is a nested object: a client that sets its own
 * `application_name` replaces the whole sub-object and would silently drop the
 * session `TimeZone`. Merging in one place is what makes "a new pool is
 * UTC-correct" true by construction instead of by review.
 */
export function withUtcTimestamps<T extends PostgresConnectionOptions>(options: T) {
  return {
    ...options,
    connection: { ...options.connection, ...UTC_CONNECTION_PARAMETERS },
    types: UTC_TIMESTAMP_TYPES,
  }
}
