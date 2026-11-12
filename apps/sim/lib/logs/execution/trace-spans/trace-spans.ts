import { isRecordLike, toArray } from '@sim/utils/object'
import { isUserFile } from '@/lib/core/utils/user-file'
import { createSpanFromLog } from '@/lib/logs/execution/trace-spans/factory'
import { groupIterationBlocks } from '@/lib/logs/execution/trace-spans/iteration-grouping'
import type { TraceSpan } from '@/lib/logs/types'
import { isSubExecutionBlockType } from '@/executor/constants'
import type { BlockLog, ExecutionResult } from '@/executor/types'
import { errorNamesBlock } from '@/executor/utils/errors'

/**
 * Keys that should be recursively filtered from output display.
 * These are internal fields used for execution tracking that shouldn't be shown to users.
 */
const HIDDEN_OUTPUT_KEYS = new Set(['childTraceSpans'])

/**
 * Whether a key is globally hidden from every output projection. Exported so
 * `filterOutputForLog` can drop it at the TOP level: `filterHiddenOutputKeys` only
 * recurses into a value, so a hidden key sitting directly on a block's output used to
 * survive unless that block's config happened to declare it `hiddenFromDisplay`.
 */
export function isHiddenOutputKey(key: string): boolean {
  return HIDDEN_OUTPUT_KEYS.has(key)
}
const SUCCESSFUL_CHILD_ERROR_BOUNDARY_BLOCK_TYPES = new Set(['mothership'])

function setFilteredValue(output: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(output, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

/**
 * Recursively filters hidden keys from nested objects for cleaner display.
 * Used by both executor (for log output) and UI (for display).
 *
 * Copy-on-write: a plain object or array whose subtree needs no change is
 * returned as-is, so a block log shares structure with the block's compacted
 * state output instead of holding a second copy for the rest of the run. A
 * copy starts only at the first changed child; non-plain prototypes (Date,
 * class instances, null-prototype objects) and file objects are always rebuilt.
 */
export function filterHiddenOutputKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return value.map((item) => filterHiddenOutputKeys(item))
    }
    let mapped: unknown[] | undefined
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) continue
      const item = value[index]
      const filteredItem = filterHiddenOutputKeys(item)
      if (!mapped && filteredItem !== item) mapped = value.slice(0, index)
      if (mapped) mapped[index] = filteredItem
    }
    if (!mapped) return value
    mapped.length = value.length
    return mapped
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    // File objects are always copied: file hydration later updates `size` in
    // place on the shared state object, and a log keeps the value it completed with.
    let filtered: Record<string, unknown> | undefined =
      Object.getPrototypeOf(value) === Object.prototype && !isUserFile(value) ? undefined : {}
    for (let index = 0; index < entries.length; index++) {
      const [key, val] = entries[index]
      const hidden = HIDDEN_OUTPUT_KEYS.has(key)
      const filteredVal = hidden ? undefined : filterHiddenOutputKeys(val)
      if (!filtered && (hidden || filteredVal !== val)) {
        filtered = {}
        for (const [previousKey, previousVal] of entries.slice(0, index)) {
          setFilteredValue(filtered, previousKey, previousVal)
        }
      }
      if (filtered && !hidden) setFilteredValue(filtered, key, filteredVal)
    }
    return filtered ?? value
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
    status: traceSpansIndicateFailure(grouped) ? 'error' : 'success',
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

/** A block that succeeded and owns its children's errors, so none of them is the run's failure. */
function isSuccessfulErrorBoundary(status: unknown, type: unknown): boolean {
  return (
    status === 'success' &&
    typeof type === 'string' &&
    SUCCESSFUL_CHILD_ERROR_BOUNDARY_BLOCK_TYPES.has(type)
  )
}

/** Options for {@link hasUnhandledError}. */
export interface UnhandledErrorOptions {
  /**
   * Also treat a failed tool call as an unhandled error. Off by default: an
   * agent that retried past a failed tool call still succeeded, so counting
   * tool calls would flip those runs to failed.
   */
  includeToolCalls?: boolean
}

/**
 * True if this span (or any descendant) has an error nothing handled. The
 * single source of truth for "did this fail?" — used for the run's root span
 * status, the persisted log level, and the UI's failure badge, so all three
 * agree on error boundaries.
 */
export function hasUnhandledError(span: TraceSpan, options?: UnhandledErrorOptions): boolean {
  if (span.status === 'error' && !span.errorHandled) return true
  if (isSuccessfulErrorBoundary(span.status, span.type)) return false
  if (span.children?.length) {
    return span.children.some((child) => hasUnhandledError(child, options))
  }
  if (options?.includeToolCalls && span.toolCalls?.length && !span.errorHandled) {
    return span.toolCalls.some((call) => call.error)
  }
  return false
}

/** True when a completed run should be recorded as failed. */
export function traceSpansIndicateFailure(
  spans: TraceSpan[] | undefined,
  options?: UnhandledErrorOptions
): boolean {
  return spans?.some((span) => hasUnhandledError(span, options)) ?? false
}

/** The block a recorded run failed in, as its trace names it. */
export interface FailedTraceBlock {
  blockId: string
  blockName: string
  blockType: string
}

interface FailedSpanCandidate {
  block: FailedTraceBlock
  endedAt: number
  /** The block log's error, which the span builder merges into its output. */
  recordedError: string | undefined
}

/** The innermost unhandled-error block spans: a container whose failure came from a block inside it yields that block. */
function collectFailedBlockSpans(nodes: unknown, into: FailedSpanCandidate[]): void {
  for (const span of toArray<unknown>(nodes)) {
    if (!isRecordLike(span)) continue
    const isError = span.status === 'error'
    const blockId = typeof span.blockId === 'string' ? span.blockId : null
    const blockType = typeof span.type === 'string' ? span.type : undefined
    const before = into.length
    const isBoundary =
      isSubExecutionBlockType(blockType) || isSuccessfulErrorBoundary(span.status, blockType)
    if (!blockId || !isBoundary) collectFailedBlockSpans(span.children, into)
    if (isError && span.errorHandled !== true && blockId && blockType && into.length === before) {
      into.push({
        block: {
          blockId,
          blockName: typeof span.name === 'string' ? span.name : blockId,
          blockType,
        },
        endedAt: typeof span.endTime === 'string' ? Date.parse(span.endTime) : Number.NaN,
        recordedError:
          isRecordLike(span.output) && typeof span.output.error === 'string'
            ? span.output.error
            : undefined,
      })
    }
  }
}

/**
 * The block a recorded run failed in, read back from its persisted trace spans.
 *
 * Given the run's stored error, only a block that owns it is named: one whose name
 * heads it (`Block name: message`, as a block failure is recorded) or whose own
 * recorded error is exactly it, as a loop or parallel failure is recorded without a
 * prefix. A run stores the error of the failure that settled first, while branches
 * already in flight may fail after it, and a run can fail outside any block while
 * one is failing; so a failed block that does not own the error is never named, and
 * among several owners the one that ended first is, or none when they cannot be told
 * apart. Without a run error, the failure that ended first is named.
 *
 * Spans are walked as {@link hasUnhandledError} walks them, including under a block
 * that succeeded, and the same boundaries hold: a successful boundary block's
 * children are not its failure. The spans under a workflow or custom block are
 * another workflow's and are not descended into, so its failure is attributed to the
 * block that ran it, as it is at execution time, and a custom block's source workflow
 * is never named to its consumer.
 *
 * Reads stored, untyped spans structurally, and of their output only the recorded
 * error. Null when the trace has no such span, including when it was not recorded,
 * was compacted, or is unavailable.
 */
export function findFailedTraceBlock(spans: unknown, runError?: string): FailedTraceBlock | null {
  const candidates: FailedSpanCandidate[] = []
  collectFailedBlockSpans(spans, candidates)
  const pool = runError
    ? candidates.filter(
        (span) => errorNamesBlock(runError, span.block.blockName) || span.recordedError === runError
      )
    : candidates
  if (pool.length <= 1) return pool[0]?.block ?? null
  if (!pool.every((span) => Number.isFinite(span.endedAt))) return null
  const [first, second] = pool.sort((a, b) => a.endedAt - b.endedAt)
  return first.endedAt < second.endedAt ? first.block : null
}

interface DurationBearingSpan {
  duration?: number
  durationMs?: number | null
  children?: DurationBearingSpan[]
}

/**
 * Publishes `durationMs` on every span of a tree from the `duration` the span
 * builders write.
 *
 * The persisted span carries only `duration`; the v2 log contract publishes
 * both names, and readers that took the documented `durationMs` at its word
 * found it null or absent on every span. Rather than rename a field every stored
 * trace already uses, the API projection fills the newer name from the older one
 * — an explicit `durationMs` on a span wins, so a span written with both keeps
 * its own value.
 */
export function withSpanDurationMs<T extends DurationBearingSpan>(
  spans: readonly T[]
): Array<T & { durationMs?: number }> {
  return spans.map((span) => ({
    ...span,
    durationMs: span.durationMs ?? span.duration,
    ...(span.children ? { children: withSpanDurationMs(span.children) } : {}),
  }))
}
