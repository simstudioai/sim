/**
 * UTC pinning for `timestamp without time zone` columns.
 *
 * Every timestamp column in `schema.ts` is bare `timestamp(...)`, which is
 * Postgres `timestamp without time zone`: the column stores a naive wall-clock
 * reading with no offset, so the instant it denotes is decided entirely by
 * whoever writes it and whoever reads it. Writers and readers disagreed —
 * `now()` and a raw `Date` bind render in the **session's** `TimeZone` while
 * drizzle's `toISOString()` always stores UTC, and postgres.js parses oid 1114
 * in the **Node process's** local zone while drizzle parses it as UTC. The
 * result is a local wall clock serialized with `toISOString()`: a `Z`-labelled
 * string naming the wrong instant, which passes every `date-time` format check
 * and silently corrupts sorts and range predicates.
 *
 * Pinned at the driver boundary rather than at the call sites, so no future
 * writer can reintroduce it: {@link UTC_CONNECTION_PARAMETERS} forces every
 * session's `TimeZone`, and {@link UTC_TIMESTAMP_TYPES} pins the read.
 *
 * `timestamptz` columns (oid 1184) are deliberately untouched: they already
 * carry an offset on the wire and round-trip correctly on their own.
 */

/** Postgres oid of `timestamp without time zone`. */
const TIMESTAMP_OID = 1114

/**
 * postgres.js startup parameters that pin the session's `TimeZone`, so `now()`
 * and any `timestamptz → timestamp` cast render the UTC wall clock drizzle's
 * `toISOString()` write already stores.
 */
export const UTC_CONNECTION_PARAMETERS = { TimeZone: 'UTC' } as const

/**
 * postgres.js `types` entry that reads and writes oid 1114 as UTC.
 *
 * `parse` appends the explicit `Z` that the naive wire form omits, making the
 * recovered instant independent of the process's local zone. `to` is never
 * selected by postgres.js's type inference (a `Date` infers as 1184), so the
 * serializer only keeps the entry self-consistent for an explicit `sql.typed`
 * bind.
 *
 * `drizzle()` registers its own oid-1114 parser when it wraps a client,
 * replacing this entry, and every client here is wrapped — drizzle's own mapper
 * (`new Date(value + '+0000')`) then supplies the same UTC reading, so the
 * clobbering is harmless. The entry is kept because it is the only thing pinning
 * the read for a client used as raw postgres.js.
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
 * session `TimeZone`.
 */
export function withUtcTimestamps<T extends PostgresConnectionOptions>(options: T) {
  return {
    ...options,
    connection: { ...options.connection, ...UTC_CONNECTION_PARAMETERS },
    types: UTC_TIMESTAMP_TYPES,
  }
}
