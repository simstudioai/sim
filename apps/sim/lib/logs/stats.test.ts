/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { buildDashboardStats, type LogStatsWindow, resolveLogStatsWindow } from '@/lib/logs/stats'
import type { LogStatsSegmentRow } from '@/lib/logs/stats-queries'

const WINDOW_START = new Date('2026-01-15T00:00:00.000Z')

const window: LogStatsWindow = {
  startTime: WINDOW_START,
  endTime: new Date('2026-01-15T02:00:00.000Z'),
  segmentMs: 60 * 60 * 1000,
}

function row(overrides: Partial<LogStatsSegmentRow> = {}): LogStatsSegmentRow {
  return {
    workflowId: 'wf-1',
    workflowName: 'Alpha',
    segmentIndex: 0,
    totalExecutions: 1,
    successfulExecutions: 1,
    avgDurationMs: 100,
    ...overrides,
  }
}

describe('resolveLogStatsWindow', () => {
  const now = new Date('2026-01-15T12:00:00.000Z')

  it('falls back to the trailing 24 hours when nothing ran', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 24, { now })

    expect(resolved.endTime).toEqual(now)
    expect(resolved.startTime).toEqual(new Date('2026-01-14T12:00:00.000Z'))
  })

  it('extends the window to now when the newest run is older', () => {
    const resolved = resolveLogStatsWindow(
      { minTime: '2026-01-15T00:00:00.000Z', maxTime: '2026-01-15T06:00:00.000Z' },
      12,
      { now }
    )

    expect(resolved.endTime).toEqual(now)
    expect(resolved.segmentMs).toBe(60 * 60 * 1000)
  })

  it('never buckets narrower than a minute', () => {
    const resolved = resolveLogStatsWindow(
      { minTime: '2026-01-15T12:00:00.000Z', maxTime: '2026-01-15T12:00:01.000Z' },
      500,
      { now }
    )

    expect(resolved.segmentMs).toBe(60_000)
  })

  it('divides by segmentCount without producing a zero-width bucket', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 1, { now })

    expect(resolved.segmentMs).toBe(24 * 60 * 60 * 1000)
  })

  /**
   * The `segmentMs` assertion is the load-bearing half: pinning `endTime`
   * alone would still pass for a fix that relabelled `timeBounds` without
   * re-deriving the bucket width the series is stamped from.
   */
  it('ends the window at the requested end rather than at now', () => {
    const resolved = resolveLogStatsWindow(
      { minTime: '2026-01-14T00:00:00.000Z', maxTime: '2026-01-14T06:00:00.000Z' },
      12,
      { requestedEnd: new Date('2026-01-14T12:00:00.000Z'), now }
    )

    expect(resolved.endTime).toEqual(new Date('2026-01-14T12:00:00.000Z'))
    expect(resolved.segmentMs).toBe(60 * 60 * 1000)
  })

  it('starts the window at the requested start rather than at the oldest run', () => {
    const resolved = resolveLogStatsWindow(
      { minTime: '2026-01-14T06:00:00.000Z', maxTime: '2026-01-14T09:00:00.000Z' },
      12,
      {
        requestedStart: new Date('2026-01-14T00:00:00.000Z'),
        requestedEnd: new Date('2026-01-14T12:00:00.000Z'),
        now,
      }
    )

    expect(resolved.startTime).toEqual(new Date('2026-01-14T00:00:00.000Z'))
    expect(resolved.segmentMs).toBe(60 * 60 * 1000)
  })

  it('reports the requested window when nothing ran inside it', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 6, {
      requestedStart: new Date('2026-01-01T00:00:00.000Z'),
      requestedEnd: new Date('2026-01-07T00:00:00.000Z'),
      now,
    })

    expect(resolved.startTime).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(resolved.endTime).toEqual(new Date('2026-01-07T00:00:00.000Z'))
    expect(resolved.segmentMs).toBe(24 * 60 * 60 * 1000)
  })

  /**
   * The case neither fallback sentence covers on its own: with no rows and only
   * a right edge, the 24-hour window is measured back from the requested end,
   * not from the wall clock.
   */
  it('measures the empty-result fallback back from a requested end', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 24, {
      requestedEnd: new Date('2026-01-10T00:00:00.000Z'),
      now,
    })

    expect(resolved.endTime).toEqual(new Date('2026-01-10T00:00:00.000Z'))
    expect(resolved.startTime).toEqual(new Date('2026-01-09T00:00:00.000Z'))
  })

  /** The dashboard schema has no `startDate <= endDate` refinement, so a crossed pair reaches here. */
  it('keeps a crossed requested pair from producing a non-positive bucket width', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 6, {
      requestedStart: new Date('2026-01-07T00:00:00.000Z'),
      requestedEnd: new Date('2026-01-01T00:00:00.000Z'),
      now,
    })

    expect(resolved.segmentMs).toBe(60_000)
  })

  it('ignores an unparseable requested bound instead of stamping Invalid Date', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 24, {
      requestedEnd: new Date('not-a-date'),
      now,
    })

    expect(resolved.endTime).toEqual(now)
    expect(resolved.startTime).toEqual(new Date('2026-01-14T12:00:00.000Z'))
  })
})

describe('buildDashboardStats', () => {
  it('materializes every bucket, including the empty ones', () => {
    const { stats } = buildDashboardStats([row({ segmentIndex: 1 })], window, 2)

    expect(stats.workflows).toHaveLength(1)
    expect(stats.workflows[0].segments).toHaveLength(2)
    expect(stats.workflows[0].segments[0]).toEqual({
      timestamp: '2026-01-15T00:00:00.000Z',
      totalExecutions: 0,
      successfulExecutions: 0,
      avgDurationMs: 0,
    })
    expect(stats.workflows[0].segments[1].totalExecutions).toBe(1)
  })

  it('clamps an out-of-range bucket index into the window', () => {
    const { stats } = buildDashboardStats(
      [row({ segmentIndex: 99 }), row({ segmentIndex: -5 })],
      window,
      2
    )

    expect(stats.workflows[0].segments[0].totalExecutions).toBe(1)
    expect(stats.workflows[0].segments[1].totalExecutions).toBe(1)
  })

  it('weights the mean duration by run count when folding rows into one bucket', () => {
    const { stats } = buildDashboardStats(
      [
        row({ workflowName: 'Alpha', totalExecutions: 1, avgDurationMs: 100 }),
        row({ workflowName: 'Alpha', totalExecutions: 3, avgDurationMs: 300 }),
      ],
      window,
      1
    )

    expect(stats.workflows[0].segments[0].avgDurationMs).toBe(250)
    expect(stats.avgLatency).toBe(250)
  })

  it('reports a workflow with no runs as fully successful rather than as zero percent', () => {
    const { stats } = buildDashboardStats(
      [row({ totalExecutions: 0, successfulExecutions: 0, avgDurationMs: 0 })],
      window,
      1
    )

    expect(stats.workflows[0].overallSuccessRate).toBe(100)
  })

  it('orders workflows by error rate, then by name', () => {
    const { stats } = buildDashboardStats(
      [
        row({
          workflowId: 'wf-clean-b',
          workflowName: 'Bravo',
          totalExecutions: 4,
          successfulExecutions: 4,
        }),
        row({
          workflowId: 'wf-clean-a',
          workflowName: 'Alpha',
          totalExecutions: 4,
          successfulExecutions: 4,
        }),
        row({
          workflowId: 'wf-broken',
          workflowName: 'Zulu',
          totalExecutions: 4,
          successfulExecutions: 1,
        }),
      ],
      window,
      1
    )

    expect(stats.workflows.map((wf) => wf.workflowName)).toEqual(['Zulu', 'Alpha', 'Bravo'])
  })

  it('counts every workflow into the aggregate before truncating the series list', () => {
    const rows = Array.from({ length: 5 }, (_unused, index) =>
      row({
        workflowId: `wf-${index}`,
        workflowName: `Workflow ${index}`,
        totalExecutions: 2,
        successfulExecutions: 1,
      })
    )

    const { stats, workflowsTruncated } = buildDashboardStats(rows, window, 1, { maxWorkflows: 2 })

    expect(workflowsTruncated).toBe(true)
    expect(stats.workflows).toHaveLength(2)
    expect(stats.totalRuns).toBe(10)
    expect(stats.totalErrors).toBe(5)
    expect(stats.aggregateSegments[0].totalExecutions).toBe(10)
  })

  /**
   * The dense `segmentCount`-length array is the expensive part, so it must be
   * built only for the series that survive `maxWorkflows`. Densifying first and
   * slicing after is invisible in the response — every assertion above still
   * passes — but at the published ceilings it allocates `workflows Ã—
   * segmentCount` segment objects to return `maxWorkflows` of them.
   *
   * Counted through `Date#toISOString`, which `segmentTimestamp` calls once per
   * segment it fills in, so the count is an exact proxy for the densification
   * work and not a wall-clock budget.
   */
  it('does not densify a segment series for a workflow the cap drops', () => {
    const workflowCount = 500
    const segmentCount = 500
    const rows = Array.from({ length: workflowCount }, (_unused, index) =>
      row({ workflowId: `wf-${index}`, workflowName: `Workflow ${index}` })
    )
    const toISOString = vi.spyOn(Date.prototype, 'toISOString')

    try {
      const { stats } = buildDashboardStats(rows, window, segmentCount, { maxWorkflows: 2 })

      expect(stats.workflows).toHaveLength(2)
      expect(stats.workflows[0].segments).toHaveLength(segmentCount)
      expect(stats.totalRuns).toBe(workflowCount)
      expect(toISOString.mock.calls.length).toBeLessThan(workflowCount * segmentCount * 0.1)
    } finally {
      toISOString.mockRestore()
    }
  })

  it('reports no truncation when the cap is not reached', () => {
    const { workflowsTruncated, stats } = buildDashboardStats([row()], window, 1, {
      maxWorkflows: 200,
    })

    expect(workflowsTruncated).toBe(false)
    expect(stats.workflows).toHaveLength(1)
  })

  it('returns an empty-but-shaped response for a workspace with no runs', () => {
    const { stats } = buildDashboardStats([], window, 2)

    expect(stats.workflows).toEqual([])
    expect(stats.aggregateSegments).toHaveLength(2)
    expect(stats.totalRuns).toBe(0)
    expect(stats.avgLatency).toBe(0)
    expect(stats.timeBounds).toEqual({
      start: '2026-01-15T00:00:00.000Z',
      end: '2026-01-15T02:00:00.000Z',
    })
  })
})
