import { groupIterationBlocks } from '@/lib/logs/execution/trace-spans/iteration-grouping'
import { createSpanFromLog } from '@/lib/logs/execution/trace-spans/span-factory'
import type { TraceSpan } from '@/lib/logs/types'
import type { BlockLog, ExecutionResult } from '@/executor/types'

/**
 * Keys that should be recursively filtered from output display.
 * These are internal fields used for execution tracking that shouldn't be shown to users.
 */
const HIDDEN_OUTPUT_KEYS = new Set(['childTraceSpans'])
const SUCCESSFUL_CHILD_ERROR_BOUNDARY_BLOCK_TYPES = new Set(['mothership'])

/**
 * Recursively filters hidden keys from nested objects for cleaner display.
 * Used by both executor (for log output) and UI (for display).
 */
export function filterHiddenOutputKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => filterHiddenOutputKeys(item))
  }

  if (typeof value === 'object') {
    const filtered: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (HIDDEN_OUTPUT_KEYS.has(key)) {
        continue
      }
      filtered[key] = filterHiddenOutputKeys(val)
    }
    return filtered
  }

  return value
}

/**
 * Builds a hierarchical trace span tree from execution logs.
 *
 * Pipeline:
 *   1. Each BlockLog becomes a TraceSpan via `createSpanFromLog`.
 *   2. Spans are sorted by start time to form a flat list of root spans.
 *   3. Loop/parallel iterations are grouped into container spans via `groupIterationBlocks`.
 *   4. A synthetic "Workflow Execution" root wraps the grouped spans and provides
 *      relative timestamps + total duration derived from the earliest start / latest end.
 */
export function buildTraceSpans(result: ExecutionResult): {
  traceSpans: TraceSpan[]
  totalDuration: number
} {
  if (!result.logs?.length) {
    return { traceSpans: [], totalDuration: 0 }
  }

  const spans = buildRootSpansFromLogs(result.logs)
  const grouped = groupIterationBlocks(spans)

  if (grouped.length === 0 || !result.metadata) {
    const totalDuration = grouped.reduce((sum, span) => sum + span.duration, 0)
    return { traceSpans: grouped, totalDuration }
  }

  return wrapInWorkflowRoot(grouped, spans)
}

/** Converts each BlockLog into a TraceSpan, sorted chronologically by start time. */
function buildRootSpansFromLogs(logs: BlockLog[]): TraceSpan[] {
  const spans: TraceSpan[] = []
  for (const log of logs) {
    const span = createSpanFromLog(log)
    if (span) spans.push(span)
  }
  spans.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  return spans
}

/**
 * Wraps grouped spans in a synthetic workflow-execution root span using the
 * true workflow bounds (earliest start / latest end across all leaf spans).
 */
function wrapInWorkflowRoot(
  grouped: TraceSpan[],
  leafSpans: TraceSpan[]
): { traceSpans: TraceSpan[]; totalDuration: number } {
  let earliestStart = Number.POSITIVE_INFINITY
  let latestEnd = 0
  for (const span of leafSpans) {
    const startTime = new Date(span.startTime).getTime()
    const endTime = new Date(span.endTime).getTime()
    if (startTime < earliestStart) earliestStart = startTime
    if (endTime > latestEnd) latestEnd = endTime
  }

  const actualWorkflowDuration = latestEnd - earliestStart
  addRelativeTimestamps(grouped, earliestStart)

  const totalCost = leafSpans.reduce((sum, s) => sum + (s.cost?.total ?? 0), 0)

  const workflowSpan: TraceSpan = {
    id: 'workflow-execution',
    name: 'Workflow Execution',
    type: 'workflow',
    duration: actualWorkflowDuration,
    startTime: new Date(earliestStart).toISOString(),
    endTime: new Date(latestEnd).toISOString(),
    status: grouped.some(hasUnhandledError) ? 'error' : 'success',
    children: grouped,
    ...(totalCost > 0 && { cost: { total: totalCost } }),
  }

  return { traceSpans: [workflowSpan], totalDuration: actualWorkflowDuration }
}

/** Recursively annotates spans with `relativeStartMs` (ms since workflow start). */
function addRelativeTimestamps(spans: TraceSpan[], workflowStartMs: number): void {
  for (const span of spans) {
    span.relativeStartMs = new Date(span.startTime).getTime() - workflowStartMs
    if (span.children?.length) {
      addRelativeTimestamps(span.children, workflowStartMs)
    }
  }
}

/** True if this span (or any descendant) has an unhandled error. */
function hasUnhandledError(span: TraceSpan): boolean {
  if (span.status === 'error' && !span.errorHandled) return true
  if (span.status === 'success' && SUCCESSFUL_CHILD_ERROR_BOUNDARY_BLOCK_TYPES.has(span.type)) {
    return false
  }
  return span.children?.some(hasUnhandledError) ?? false
}
