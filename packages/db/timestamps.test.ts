/**
 * @vitest-environment node
 *
 * These assertions are only meaningful when the process is NOT running in UTC:
 * a local-time defect is invisible when local time *is* UTC. `TZ` is therefore
 * pinned to a non-UTC zone, and {@link isProcessInUtc} fails the suite outright
 * if the runtime ignored it, rather than letting the file pass vacuously. The
 * assignment sits below the imports because ESM hoists them regardless; what
 * matters is that it runs before any `Date` is constructed, and every `Date`
 * here is built inside a test body.
 */

import {
  UTC_CONNECTION_PARAMETERS,
  UTC_TIMESTAMP_TYPES,
  withUtcTimestamps,
} from '@sim/db/timestamps'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

process.env.TZ = 'Asia/Tokyo'

/** Postgres oid of `timestamp without time zone`. */
const TIMESTAMP_OID = 1114

/** A naive `timestamp` value exactly as Postgres renders it on the wire. */
const NAIVE_WIRE_VALUE = '2026-08-13 02:44:03.42'
const NAIVE_WIRE_INSTANT = '2026-08-13T02:44:03.420Z'

function isProcessInUtc(): boolean {
  return new Date().getTimezoneOffset() === 0
}

/**
 * The parser postgres.js would actually apply to oid 1114 for a client built
 * with `options`. Constructing a client does not open a connection, so this
 * reads the real resolved configuration without touching a database.
 */
function resolveTimestampParser(options: Parameters<typeof postgres>[1]) {
  const client = postgres('postgres://user@localhost:5432/db', options)
  return (client.options as { parsers: Record<number, (value: string) => unknown> }).parsers[
    TIMESTAMP_OID
  ]
}

describe('naive timestamp UTC pinning', () => {
  it('runs outside UTC, so a local-time defect is observable', () => {
    expect(isProcessInUtc()).toBe(false)
  })

  it('pins the session TimeZone so every writer stores the same wall clock', () => {
    expect(UTC_CONNECTION_PARAMETERS.TimeZone).toBe('UTC')
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

  it('is what a client built through withUtcTimestamps actually applies', () => {
    const parse = resolveTimestampParser(
      withUtcTimestamps({ connection: { application_name: 'test' } })
    )
    expect((parse(NAIVE_WIRE_VALUE) as Date).toISOString()).toBe(NAIVE_WIRE_INSTANT)
  })

  it('keeps the session TimeZone when a caller sets its own connection params', () => {
    const merged = withUtcTimestamps({ connection: { application_name: 'sub-pool' } })
    expect(merged.connection).toEqual({ application_name: 'sub-pool', TimeZone: 'UTC' })
  })
})
