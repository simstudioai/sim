/**
 * Legacy's logs-dashboard segment selection: which time segments of which workflows the reader
 * picked, and the runs, errors and latency of only those segments.
 */
import { omit } from '@sim/utils/object'

/** A pick's gesture: a plain click, Cmd/Ctrl-click, or Shift-click. */
export type SegmentPickMode = 'single' | 'toggle' | 'range'

export interface SegmentSelection {
  /** Each workflow's picked segment indices, ascending; a workflow with none has no entry. */
  segments: Readonly<Record<string, readonly number[]>>
  /** Where each workflow's last plain or Cmd/Ctrl pick landed, which a Shift pick extends from. */
  anchors: Readonly<Record<string, number>>
}

export const NO_SEGMENTS: SegmentSelection = { segments: {}, anchors: {} }

export function hasSegments(selection: SegmentSelection) {
  return Object.keys(selection.segments).length > 0
}

/**
 * The selection after a pick. A plain click picks only that segment, or clears everything when it
 * was already the one picked segment; Cmd/Ctrl-click toggles it within its workflow; Shift-click
 * adds the run of segments from the workflow's anchor to it.
 */
export function pickSegment(
  selection: SegmentSelection,
  workflowId: string,
  index: number,
  mode: SegmentPickMode
): SegmentSelection {
  const current = selection.segments[workflowId] ?? []
  if (mode === 'single') {
    const onlyPick =
      current.length === 1 && current[0] === index && Object.keys(selection.segments).length === 1
    return onlyPick
      ? NO_SEGMENTS
      : { segments: { [workflowId]: [index] }, anchors: { [workflowId]: index } }
  }
  if (mode === 'toggle') {
    const next = current.includes(index)
      ? current.filter((picked) => picked !== index)
      : [...current, index].sort((left, right) => left - right)
    const others = omit(selection.segments, [workflowId])
    return {
      segments: next.length ? { ...others, [workflowId]: next } : others,
      anchors: { ...selection.anchors, [workflowId]: index },
    }
  }
  const anchor = selection.anchors[workflowId] ?? index
  const [start, end] = anchor < index ? [anchor, index] : [index, anchor]
  const range = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
  return {
    segments: {
      ...selection.segments,
      [workflowId]: [...new Set([...current, ...range])].sort((left, right) => left - right),
    },
    anchors: selection.anchors,
  }
}

/** One workflow segment's counts, as the dashboard reads them. */
interface SegmentCounts {
  runs: number
  failed: number
  avgDurationMs: number
}

interface SegmentWorkflow {
  id: string
  segments: readonly SegmentCounts[]
}

interface SeriesPoint {
  at: number
  value: number
}

/**
 * The picked segments' charts and totals: one point per picked segment index, in time order,
 * summing the workflows (among those shown) that picked it, with latency weighted by runs.
 * `segmentStarts` holds each segment's start, by index.
 */
export function pickedSegmentSeries(
  selection: SegmentSelection,
  workflows: readonly SegmentWorkflow[],
  segmentStarts: readonly number[]
) {
  const indices = [...new Set(Object.values(selection.segments).flat())].sort(
    (left, right) => left - right
  )
  const points = indices.map((index) => {
    let runs = 0
    let failed = 0
    let weightedLatency = 0
    let timedRuns = 0
    for (const [workflowId, picked] of Object.entries(selection.segments)) {
      if (!picked.includes(index)) continue
      const segment = workflows.find((workflow) => workflow.id === workflowId)?.segments[index]
      if (!segment) continue
      runs += segment.runs
      failed += segment.failed
      if (segment.avgDurationMs && segment.runs) {
        weightedLatency += segment.avgDurationMs * segment.runs
        timedRuns += segment.runs
      }
    }
    return {
      at: segmentStarts[index] ?? 0,
      runs,
      failed,
      latencyMs: timedRuns > 0 ? weightedLatency / timedRuns : 0,
    }
  })
  const series = (pick: (point: (typeof points)[number]) => number): SeriesPoint[] =>
    points.map((point) => ({ at: point.at, value: pick(point) }))
  let weightedLatency = 0
  let timedRuns = 0
  for (const point of points) {
    if (point.latencyMs && point.runs > 0) {
      weightedLatency += point.latencyMs * point.runs
      timedRuns += point.runs
    }
  }
  return {
    totals: {
      runs: points.reduce((sum, point) => sum + point.runs, 0),
      errors: points.reduce((sum, point) => sum + point.failed, 0),
      latencyMs: timedRuns > 0 ? weightedLatency / timedRuns : 0,
    },
    runs: series((point) => point.runs),
    errors: series((point) => point.failed),
    latency: series((point) => point.latencyMs),
  }
}
