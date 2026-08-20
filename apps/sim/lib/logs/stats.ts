import type { DashboardStatsResponse, SegmentStats, WorkflowStats } from '@/lib/api/contracts/logs'
import type { LogStatsBounds, LogStatsSegmentRow } from '@/lib/logs/stats-queries'

/** Narrowest segment the dashboard will bucket into, so a short window is not sliced into sub-minute noise. */
const MIN_SEGMENT_MS = 60_000

/** The time window the segments cover, and how wide each one is. */
export interface LogStatsWindow {
  startTime: Date
  endTime: Date
  segmentMs: number
}

/**
 * The window the segments span, derived from the rows that exist rather than
 * from a caller-supplied range.
 *
 * A workspace with no runs still has to answer with a window, because
 * `segmentMs` and every segment timestamp are computed from one — hence the
 * trailing-24-hour fallback. The end is pushed to `now` whenever the newest run
 * is older than that, so a live dashboard's right edge is the present rather
 * than the last thing that happened.
 */
export function resolveLogStatsWindow(
  bounds: LogStatsBounds,
  segmentCount: number,
  now: Date = new Date()
): LogStatsWindow {
  let startTime: Date
  let endTime: Date

  if (!bounds.minTime || !bounds.maxTime) {
    endTime = now
    startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  } else {
    startTime = new Date(bounds.minTime)
    endTime = new Date(Math.max(new Date(bounds.maxTime).getTime(), now.getTime()))
  }

  const totalMs = Math.max(1, endTime.getTime() - startTime.getTime())
  return {
    startTime,
    endTime,
    segmentMs: Math.max(MIN_SEGMENT_MS, Math.floor(totalMs / segmentCount)),
  }
}

export interface BuildDashboardStatsOptions {
  /**
   * Largest number of per-workflow series to return. Omitted means every
   * workflow, which is what the first-party dashboard reads.
   */
  maxWorkflows?: number
}

export interface DashboardStatsResult {
  stats: DashboardStatsResponse
  /** Whether `stats.workflows` was cut down to `maxWorkflows`. */
  workflowsTruncated: boolean
}

/**
 * Folds grouped `(workflow, segment)` counts into the dashboard's per-workflow
 * series and the workspace aggregate.
 *
 * Pure by construction — no database, no authorization — so the bucketing,
 * weighting, and truncation rules below are directly testable, which they were
 * not while they lived inside the route handler.
 *
 * The aggregate is summed over every workflow *before* `maxWorkflows` is
 * applied. Truncating first would silently under-report `totalRuns`,
 * `totalErrors`, and `avgLatency` for the workspace — a wrong answer, where a
 * shortened `workflows` list paired with `workflowsTruncated: true` is merely an
 * incomplete one.
 */
export function buildDashboardStats(
  rows: readonly LogStatsSegmentRow[],
  window: LogStatsWindow,
  segmentCount: number,
  options: BuildDashboardStatsOptions = {}
): DashboardStatsResult {
  const { startTime, endTime, segmentMs } = window
  const segmentTimestamp = (index: number) =>
    new Date(startTime.getTime() + index * segmentMs).toISOString()

  const workflowMap = new Map<
    string,
    {
      workflowId: string
      workflowName: string
      segments: Map<number, SegmentStats>
      totalExecutions: number
      totalSuccessful: number
    }
  >()

  for (const row of rows) {
    const segmentIndex = Math.min(
      segmentCount - 1,
      Math.max(0, Math.floor(Number(row.segmentIndex)))
    )

    let wf = workflowMap.get(row.workflowId)
    if (!wf) {
      wf = {
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        segments: new Map(),
        totalExecutions: 0,
        totalSuccessful: 0,
      }
      workflowMap.set(row.workflowId, wf)
    }

    wf.totalExecutions += Number(row.totalExecutions)
    wf.totalSuccessful += Number(row.successfulExecutions)

    const existing = wf.segments.get(segmentIndex)
    if (existing) {
      const oldTotal = existing.totalExecutions
      const newTotal = oldTotal + Number(row.totalExecutions)
      existing.totalExecutions = newTotal
      existing.successfulExecutions += Number(row.successfulExecutions)
      existing.avgDurationMs =
        newTotal > 0
          ? (existing.avgDurationMs * oldTotal +
              Number(row.avgDurationMs || 0) * Number(row.totalExecutions)) /
            newTotal
          : 0
    } else {
      wf.segments.set(segmentIndex, {
        timestamp: segmentTimestamp(segmentIndex),
        totalExecutions: Number(row.totalExecutions),
        successfulExecutions: Number(row.successfulExecutions),
        avgDurationMs: Number(row.avgDurationMs || 0),
      })
    }
  }

  const workflows: WorkflowStats[] = []
  for (const wf of workflowMap.values()) {
    const segments: SegmentStats[] = []
    for (let i = 0; i < segmentCount; i++) {
      segments.push(
        wf.segments.get(i) ?? {
          timestamp: segmentTimestamp(i),
          totalExecutions: 0,
          successfulExecutions: 0,
          avgDurationMs: 0,
        }
      )
    }

    workflows.push({
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
      segments,
      totalExecutions: wf.totalExecutions,
      totalSuccessful: wf.totalSuccessful,
      overallSuccessRate:
        wf.totalExecutions > 0 ? (wf.totalSuccessful / wf.totalExecutions) * 100 : 100,
    })
  }

  workflows.sort((a, b) => {
    const errA = a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
    const errB = b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
    if (errA !== errB) return errB - errA
    return a.workflowName.localeCompare(b.workflowName)
  })

  const aggregateSegments: SegmentStats[] = []
  let totalRuns = 0
  let totalErrors = 0
  let weightedLatencySum = 0
  let latencyCount = 0

  for (let i = 0; i < segmentCount; i++) {
    let segTotal = 0
    let segSuccess = 0
    let segWeightedLatency = 0
    let segLatencyCount = 0

    for (const wf of workflows) {
      const seg = wf.segments[i]
      segTotal += seg.totalExecutions
      segSuccess += seg.successfulExecutions
      if (seg.avgDurationMs > 0 && seg.totalExecutions > 0) {
        segWeightedLatency += seg.avgDurationMs * seg.totalExecutions
        segLatencyCount += seg.totalExecutions
      }
    }

    totalRuns += segTotal
    totalErrors += segTotal - segSuccess
    weightedLatencySum += segWeightedLatency
    latencyCount += segLatencyCount

    aggregateSegments.push({
      timestamp: segmentTimestamp(i),
      totalExecutions: segTotal,
      successfulExecutions: segSuccess,
      avgDurationMs: segLatencyCount > 0 ? segWeightedLatency / segLatencyCount : 0,
    })
  }

  const workflowsTruncated =
    options.maxWorkflows !== undefined && workflows.length > options.maxWorkflows

  return {
    stats: {
      workflows: workflowsTruncated ? workflows.slice(0, options.maxWorkflows) : workflows,
      aggregateSegments,
      totalRuns,
      totalErrors,
      avgLatency: latencyCount > 0 ? weightedLatencySum / latencyCount : 0,
      timeBounds: { start: startTime.toISOString(), end: endTime.toISOString() },
      segmentMs,
    },
    workflowsTruncated,
  }
}
