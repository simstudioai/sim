/**
 * @vitest-environment node
 *
 * These assertions are only meaningful when the process is NOT running in UTC:
 * a local-time defect is invisible when local time *is* UTC. `TZ` is therefore
 * pinned to a non-UTC zone, and {@link isProcessInUtc} fails the suite outright
 * if the runtime ignored it, rather than letting the file pass vacuously.
 *
 * The zone is set and restored around this file rather than assigned at module
 * scope. `TZ` is process state, not module state, and a worker that runs test
 * files back to back in one process carries the assignment into every file that
 * follows — an unrelated suite would then read local time as Tokyo, and only
 * when the file ordering put it after this one. Every `Date` here is built
 * inside a test body, so a hook is early enough to pin the zone for all of them.
 */

import {
  UTC_CONNECTION_PARAMETERS,
  UTC_TIMESTAMP_TYPES,
  withUtcTimestamps,
} from '@sim/db/timestamps'
import { pgTable, timestamp } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_TIME_ZONE = 'Asia/Tokyo'

/** Postgres oid of `timestamp without time zone`. */
const TIMESTAMP_OID = 1114

/** A naive `timestamp` value exactly as Postgres renders it on the wire. */
const NAIVE_WIRE_VALUE = '2026-08-13 02:44:03.42'
const NAIVE_WIRE_INSTANT = '2026-08-13T02:44:03.420Z'

/** Stands in for any `timestamp without time zone` column in `schema.ts`. */
const naiveColumn = pgTable('probe', { at: timestamp('at') }).at

function isProcessInUtc(): boolean {
  return new Date().getTimezoneOffset() === 0
}

type TimestampParser = (value: string) => unknown

/**
 * Builds a postgres.js client the way `db.ts` does and returns the parser it
 * resolves for oid 1114. Constructing a client does not open a connection, so
 * this reads the real resolved configuration without touching a database.
 *
 * `wrapInDrizzle` selects whether that is the parser the driver starts with or
 * the one it ends up with after `drizzle()` has registered its own. Production
 * is always the latter: every client in this repo is handed straight to
 * `drizzle()`.
 */
function resolveTimestampParser(wrapInDrizzle: boolean): TimestampParser {
  const client = postgres(
    'postgres://user@localhost:5432/db',
    withUtcTimestamps({ connection: { application_name: 'test' } })
  )
  if (wrapInDrizzle) drizzle(client, {})
  return (client.options as { parsers: Record<number, TimestampParser> }).parsers[TIMESTAMP_OID]
}

describe('naive timestamp UTC pinning', () => {
  const ambientTimeZone = process.env.TZ

  beforeAll(() => {
    process.env.TZ = TEST_TIME_ZONE
  })

  afterAll(() => {
    /**
     * Removed rather than assigned `undefined`: assigning it would leave the
     * literal string `"undefined"` in the environment, which is a zone name no
     * runtime resolves.
     */
    if (ambientTimeZone === undefined) Reflect.deleteProperty(process.env, 'TZ')
    else process.env.TZ = ambientTimeZone
  })

  it('runs outside UTC, so a local-time defect is observable', () => {
    expect(isProcessInUtc()).toBe(false)
  })

  it('pins the session TimeZone so every writer stores the same wall clock', () => {
    expect(UTC_CONNECTION_PARAMETERS.TimeZone).toBe('UTC')
  })

  it('keeps the session TimeZone when a caller sets its own connection params', () => {
    const merged = withUtcTimestamps({ connection: { application_name: 'sub-pool' } })
    expect(merged.connection).toEqual({ application_name: 'sub-pool', TimeZone: 'UTC' })
  })

  it('reads a naive timestamp as UTC rather than the process zone', () => {
    const parsed = UTC_TIMESTAMP_TYPES.utcTimestamp.parse(NAIVE_WIRE_VALUE)
    expect(parsed.toISOString()).toBe(NAIVE_WIRE_INSTANT)
  })

  it('round-trips an instant through the naive wire form unchanged', () => {
    const instant = new Date('2026-08-13T02:44:03.420Z')
    const serialized = UTC_TIMESTAMP_TYPES.utcTimestamp.serialize(instant)
    /** Postgres discards the offset designator when parsing into a naive column. */
    const storedWallClock = serialized.replace('T', ' ').replace('Z', '')
    expect(UTC_TIMESTAMP_TYPES.utcTimestamp.parse(storedWallClock).getTime()).toBe(
      instant.getTime()
    )
  })

  it('registers the UTC parser on a bare postgres.js client', () => {
    const parse = resolveTimestampParser(false)
    expect(parse(NAIVE_WIRE_VALUE)).toEqual(new Date(NAIVE_WIRE_INSTANT))
  })

  /**
   * `drizzle()` installs its own transparent parser over the oids it maps,
   * including 1114, so the entry `withUtcTimestamps` registered is replaced the
   * moment a client is wrapped. Every client in this repo is wrapped, which
   * makes the registration above true but not load-bearing — asserting only the
   * registration passes whether or not the parser has any effect. This pins the
   * fact the next case depends on, so a drizzle version that stops clobbering
   * turns the file red instead of silently changing which layer decides the
   * instant.
   */
  it('has that parser overwritten by drizzle, so registration alone proves nothing', () => {
    const parse = resolveTimestampParser(true)
    expect(parse(NAIVE_WIRE_VALUE)).toBe(NAIVE_WIRE_VALUE)
  })

  /**
   * What actually carries the read-side guarantee for a drizzle client:
   * `PgTimestamp.mapFromDriverValue` appends `+0000` to a naive string, so the
   * recovered instant is UTC regardless of which parser won the oid. Both
   * branches are asserted together because the composition is the contract —
   * the read must not depend on which of the two layers got there first.
   */
  it('recovers the same UTC instant through either parser once drizzle maps it', () => {
    const instant = new Date(NAIVE_WIRE_INSTANT)

    expect(naiveColumn.mapFromDriverValue(resolveTimestampParser(true)(NAIVE_WIRE_VALUE))).toEqual(
      instant
    )
    expect(naiveColumn.mapFromDriverValue(resolveTimestampParser(false)(NAIVE_WIRE_VALUE))).toEqual(
      instant
    )
  })
})
