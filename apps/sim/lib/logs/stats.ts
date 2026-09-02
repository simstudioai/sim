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

/** Requested window and clock overrides for {@link resolveLogStatsWindow}. */
export interface ResolveLogStatsWindowOptions {
  /** Caller-supplied left edge, when the request named one. */
  requestedStart?: Date
  /** Caller-supplied right edge, when the request named one. */
  requestedEnd?: Date
  /** Wall clock, injectable so the fallbacks are deterministic under test. */
  now?: Date
}

/** An unparseable bound is treated as absent rather than as `Invalid Date`. */
function usableBound(bound: Date | undefined): Date | undefined {
  return bound && Number.isFinite(bound.getTime()) ? bound : undefined
}

/**
 * The window the segments span.
 *
 * An edge the caller named wins outright: no run outside it can be counted, so
 * deriving the span from anything else stamps trailing buckets the query has
 * already excluded and computes `segmentMs` over a width nobody asked for.
 *
 * An omitted edge still falls back to the rows that exist — the oldest matching
 * run on the left, and on the right the later of the newest matching run and
 * `now`, so a live dashboard's right edge is the present rather than the last
 * thing that happened.
 *
 * A workspace with no matching runs still has to answer with a window, because
 * `segmentMs` and every segment timestamp are computed from one — hence the
 * 24-hour fallback. It is measured back from the right edge, so an empty result
 * with no bounds reports the trailing 24 hours, and an empty result with only
 * an `endDate` reports the 24 hours preceding that date.
 */
export function resolveLogStatsWindow(
  bounds: LogStatsBounds,
  segmentCount: number,
  options: ResolveLogStatsWindowOptions = {}
): LogStatsWindow {
  const requestedStart = usableBound(options.requestedStart)
  const requestedEnd = usableBound(options.requestedEnd)
  const now = options.now ?? new Date()

  let startTime: Date
  let endTime: Date

  if (!bounds.minTime || !bounds.maxTime) {
    endTime = requestedEnd ?? now
    startTime = requestedStart ?? new Date(endTime.getTime() - 24 * 60 * 60 * 1000)
  } else {
    startTime = requestedStart ?? new Date(bounds.minTime)
    endTime = requestedEnd ?? new Date(Math.max(new Date(bounds.maxTime).getTime(), now.getTime()))
  }

  /**
   * A crossed pair reaches here from the first-party dashboard, whose query
   * schema carries no `startDate <= endDate` refinement, so the floor is what
   * keeps `segmentMs` positive instead of zero or negative.
   */
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
  /**
   * Whether buckets with no runs are materialized. Defaults to `true`, the
   * dense series the first-party dashboard charts. `false` publishes only the
   * buckets that hold at least one run — never more than `segmentCount` of
   * them — so a handful of runs on a wide window is a handful of entries rather
   * than `segmentCount` near-identical zero rows. The totals, `segmentMs`, and
   * each bucket's `timestamp` are unaffected: an omitted bucket contributed
   * nothing to any of them.
   */
  includeEmpty?: boolean
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
 * incomplete one. It sums from the sparse per-workflow maps rather than from
 * densified series, so summing over every workflow does not mean materializing
 * one `segmentCount`-length array per workflow: only the series that survive
 * `maxWorkflows` are ever densified.
 */
export function buildDashboardStats(
  rows: readonly LogStatsSegmentRow[],
  window: LogStatsWindow,
  segmentCount: number,
  options: BuildDashboardStatsOptions = {}
): DashboardStatsResult {
  const { startTime, endTime, segmentMs } = window
  const includeEmpty = options.includeEmpty !== false
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

  /**
   * Ordered before the segment arrays are densified, so the sort key comes from
   * the accumulated totals rather than from a materialized series.
   */
  const accumulated = [...workflowMap.values()]
  accumulated.sort((a, b) => {
    const rateA = a.totalExecutions > 0 ? (a.totalSuccessful / a.totalExecutions) * 100 : 100
    const rateB = b.totalExecutions > 0 ? (b.totalSuccessful / b.totalExecutions) * 100 : 100
    const errA = rateA < 100 ? 1 - rateA / 100 : 0
    const errB = rateB < 100 ? 1 - rateB / 100 : 0
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

    /**
     * Summed from the sparse per-workflow maps, over every workflow in the
     * window rather than only the retained ones. A segment a workflow has no
     * rows for contributes nothing, which is exactly what its densified
     * all-zero entry contributed.
     */
    for (const wf of accumulated) {
      const seg = wf.segments.get(i)
      if (!seg) continue
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

    if (segTotal === 0 && !includeEmpty) continue
    aggregateSegments.push({
      timestamp: segmentTimestamp(i),
      totalExecutions: segTotal,
      successfulExecutions: segSuccess,
      avgDurationMs: segLatencyCount > 0 ? segWeightedLatency / segLatencyCount : 0,
    })
  }

  const workflowsTruncated =
    options.maxWorkflows !== undefined && accumulated.length > options.maxWorkflows
  const retained = workflowsTruncated ? accumulated.slice(0, options.maxWorkflows) : accumulated

  /**
   * Densified last, and only for the series that survive `maxWorkflows`. Doing
   * it before the cut allocates `segmentCount` entries for every workflow in
   * the window — at the published ceilings, millions of objects to return two
   * hundred series.
   */
  const workflows: WorkflowStats[] = retained.map((wf) => {
    const segments: SegmentStats[] = []
    for (let i = 0; i < segmentCount; i++) {
      const segment = wf.segments.get(i)
      if (segment) {
        segments.push(segment)
        continue
      }
      if (!includeEmpty) continue
      segments.push({
        timestamp: segmentTimestamp(i),
        totalExecutions: 0,
        successfulExecutions: 0,
        avgDurationMs: 0,
      })
    }
    return {
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
      segments,
      totalExecutions: wf.totalExecutions,
      totalSuccessful: wf.totalSuccessful,
      overallSuccessRate:
        wf.totalExecutions > 0 ? (wf.totalSuccessful / wf.totalExecutions) * 100 : 100,
    }
  })

  return {
    stats: {
      workflows,
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
