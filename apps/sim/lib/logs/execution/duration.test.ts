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
   * `started_at` is `timestamp without time zone` holding a UTC wall clock. The
   * end instant is bound through that column's mapper, which emits a UTC ISO
   * string; the explicit cast drops the offset to the same naive reading rather
   * than leaving the interval to depend on how Postgres resolves the operator.
   */
  it('binds the end instant as a zone-free timestamp', () => {
    const { sql, params } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain('::timestamp -')
    expect(sql).not.toContain('::timestamptz')
    expect(params).toContain('2026-08-13T12:00:05.000Z')
    expect(params.some((param) => Array.isArray(param))).toBe(false)
  })

  /** The column is `integer`, and a sub-millisecond run still ran. */
  it('yields a whole number of milliseconds, floored at one', () => {
    const { sql } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain('GREATEST(1,')
    expect(sql).toContain('ROUND(')
    expect(sql).toContain('::integer')
  })

  /**
   * An untimed run cancelled after ~24.8 days exceeds `integer`. Without the
   * ceiling the cast raises, and the terminal write is lost entirely — the row
   * stays `running` with no end timestamp, which is worse than a saturated
   * duration.
   */
  it('saturates at the column ceiling instead of overflowing the cast', () => {
    const { sql, params } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain('LEAST(')
    expect(params).toContain(2_147_483_647)
  })

  /**
   * A paused run records its *active* duration at the pause checkpoint. Elapsed
   * wall clock through a later cancel includes the time it sat waiting, so
   * overwriting would silently redefine what the column means for that run.
   */
  it('keeps the duration a paused run already recorded', () => {
    const { sql } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql).toContain(`"status" = 'pending' THEN "workflow_execution_logs"."total_duration_ms"`)
  })

  /**
   * Resuming flips the row back to `running` and leaves the checkpoint value
   * behind, so a resumed run carries a stale duration while it is accruing time
   * again. Preserving it would freeze a cancelled run at its pre-resume reading.
   */
  it('recomputes for a running row rather than trusting a stale checkpoint', () => {
    const { sql } = render(new Date('2026-08-13T12:00:05.000Z'))

    const fallback = sql.slice(sql.indexOf('END,'))
    expect(fallback).toContain('LEAST(')
    expect(fallback).not.toContain('"total_duration_ms"')
  })

  /**
   * The preserved-checkpoint rule and the elapsed fallback are one `COALESCE`
   * over a valueless-`ELSE` `CASE`, not a `CASE` repeating the elapsed
   * expression in both branches. `status` is `NOT NULL` and `started_at` is
   * `NOT NULL`, so the `CASE` yields NULL exactly for a non-`pending` row or a
   * `pending` row that never recorded one — the two cases that must fall
   * through — and the fallback can never itself be NULL.
   */
  it('builds the elapsed expression once', () => {
    const { sql, params } = render(new Date('2026-08-13T12:00:05.000Z'))

    expect(sql.match(/LEAST\(/g)).toHaveLength(1)
    expect(params).toHaveLength(2)
  })
})
