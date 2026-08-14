/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { cancelledExecutionLogFields, terminalExecutionLogFields } = await import(
  '@/lib/logs/execution/cancellation'
)

describe('cancelledExecutionLogFields', () => {
  /**
   * The five cancellation paths spread this payload into their own `.set()`.
   * Hand-assembling it at each one had already dropped `executionDeadlineAt` at
   * a single site, so the point of the factory is that the key set cannot vary
   * between them — a field added here without a reason reaches all five.
   */
  it('writes exactly the terminal fields, deadline cleared', () => {
    const endedAt = new Date('2026-08-13T12:00:05.000Z')

    const fields = cancelledExecutionLogFields(endedAt)

    expect(Object.keys(fields).sort()).toEqual([
      'endedAt',
      'executionDeadlineAt',
      'status',
      'totalDurationMs',
    ])
    expect(fields.status).toBe('cancelled')
    expect(fields.endedAt).toBe(endedAt)
    expect(fields.executionDeadlineAt).toBeNull()
  })

  /** `ended_at` and `total_duration_ms` must describe the same instant. */
  it('derives the duration from the same instant it ends the run at', () => {
    const endedAt = new Date('2026-08-13T12:00:05.000Z')

    const { params } = new PgDialect().sqlToQuery(
      cancelledExecutionLogFields(endedAt).totalDurationMs
    )

    expect(params).toContain(endedAt.toISOString())
  })
})

describe('terminalExecutionLogFields', () => {
  /**
   * The force-fail boundaries — `LoggingSession.markExecutionAsFailed` and
   * `PauseResumeManager.markResumeFailed` — leave the same row behind as a
   * cancellation, only under a different status. Only the status may differ.
   */
  it('writes the cancellation field set under the failed status', () => {
    const endedAt = new Date('2026-08-13T12:00:05.000Z')

    const failed = terminalExecutionLogFields('failed', endedAt)

    expect(Object.keys(failed).sort()).toEqual(
      Object.keys(cancelledExecutionLogFields(endedAt)).sort()
    )
    expect(failed.status).toBe('failed')
    expect(failed.endedAt).toBe(endedAt)
    expect(failed.executionDeadlineAt).toBeNull()

    const { params } = new PgDialect().sqlToQuery(failed.totalDurationMs)
    expect(params).toContain(endedAt.toISOString())
  })

  /** The cancellation call sites must keep emitting exactly what they did. */
  it('is what the cancellation binding emits', () => {
    const endedAt = new Date('2026-08-13T12:00:05.000Z')
    const dialect = new PgDialect()

    const bound = cancelledExecutionLogFields(endedAt)
    const direct = terminalExecutionLogFields('cancelled', endedAt)

    expect({ ...bound, totalDurationMs: dialect.sqlToQuery(bound.totalDurationMs) }).toEqual({
      ...direct,
      totalDurationMs: dialect.sqlToQuery(direct.totalDurationMs),
    })
  })
})
