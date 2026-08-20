/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
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
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 24, now)

    expect(resolved.endTime).toEqual(now)
    expect(resolved.startTime).toEqual(new Date('2026-01-14T12:00:00.000Z'))
  })

  it('extends the window to now when the newest run is older', () => {
    const resolved = resolveLogStatsWindow(
      { minTime: '2026-01-15T00:00:00.000Z', maxTime: '2026-01-15T06:00:00.000Z' },
      12,
      now
    )

    expect(resolved.endTime).toEqual(now)
    expect(resolved.segmentMs).toBe(60 * 60 * 1000)
  })

  it('never buckets narrower than a minute', () => {
    const resolved = resolveLogStatsWindow(
      { minTime: '2026-01-15T12:00:00.000Z', maxTime: '2026-01-15T12:00:01.000Z' },
      500,
      now
    )

    expect(resolved.segmentMs).toBe(60_000)
  })

  it('divides by segmentCount without producing a zero-width bucket', () => {
    const resolved = resolveLogStatsWindow({ minTime: null, maxTime: null }, 1, now)

    expect(resolved.segmentMs).toBe(24 * 60 * 60 * 1000)
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
