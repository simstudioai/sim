/**
 * @vitest-environment node
 */

// Renders the real expression against the real drizzle dialect and schema. It
// is a raw `sql` template, so a rendering or type-cast bug only surfaces when
// Postgres executes it — the global drizzle/schema mocks would hide it.
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { elapsedDurationMsSql } = await import('@/lib/logs/execution/duration')

function render(endedAt: Date) {
  return new PgDialect().sqlToQuery(elapsedDurationMsSql(endedAt))
}

describe('elapsedDurationMsSql', () => {
  it('measures against the row started_at rather than a second clock read', () => {
    const { sql } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain('"started_at"')
    expect(sql).not.toContain('now()')
  })

  /**
   * `started_at` is `timestamp without time zone` holding a UTC wall clock. A
   * driver-bound `Date` infers `timestamptz`, which would make the interval
   * depend on the session zone; the explicit cast is what keeps it stable.
   */
  it('binds the end instant as a zone-free timestamp', () => {
    const { sql, params } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain('::timestamp')
    expect(params).toEqual(['2026-08-13T12:00:05.000Z'])
    expect(params.some((param) => Array.isArray(param))).toBe(false)
  })

  /** The column is `integer`, and a sub-millisecond run still ran. */
  it('yields a whole number of milliseconds, floored at one', () => {
    const { sql } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain('GREATEST(1,')
    expect(sql).toContain('ROUND(')
    expect(sql).toContain('::integer')
  })
})
