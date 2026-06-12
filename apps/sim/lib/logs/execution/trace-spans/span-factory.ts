import { createLogger } from '@sim/logger'
import type { ProviderTiming, TraceSpan } from '@/lib/logs/types'
import {
  isConditionBlockType,
  isWorkflowBlockType,
  stripCustomToolPrefix,
} from '@/executor/constants'
import type {
  BlockLog,
  BlockToolCall,
  NormalizedBlockOutput,
  ProviderTimingSegment,
} from '@/executor/types'

const logger = createLogger('SpanFactory')

/** A BlockLog that has already passed the id/type validity check. */
type ValidBlockLog = BlockLog & { blockType: string }

/**
 * Creates a TraceSpan from a BlockLog. Returns null for invalid logs.
 *
 * Children are unified under `span.children` regardless of source:
 *   - Provider `timeSegments` become model/tool child spans with tool I/O merged in
 *   - `output.toolCalls` (no segments) become tool child spans
 *   - Child workflow spans are flattened into children
 */
export function createSpanFromLog(log: BlockLog): TraceSpan | null {
  if (!log.blockId || !log.blockType) return null
  const validLog = log as ValidBlockLog

  const span = createBaseSpan(validLog)

  if (!isConditionBlockType(validLog.blockType)) {
    enrichWithProviderMetadata(span, validLog)

    if (!isWorkflowBlockType(validLog.blockType)) {
      const segments = validLog.output?.providerTiming?.timeSegments
      span.children = segments
        ? buildChildrenFromTimeSegments(span, validLog, segments)
        : buildChildrenFromToolCalls(span, validLog)
    }
  }

  if (isWorkflowBlockType(validLog.blockType)) {
    attachChildWorkflowSpans(span, validLog)
  }

  return span
}

/** Creates the base span with id, name, type, timing, status, and metadata. */
function createBaseSpan(log: ValidBlockLog): TraceSpan {
  const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
  const output = extractDisplayOutput(log)
  const childIds = extractChildWorkflowIds(log.output)

  return {
    id: spanId,
    name: log.blockName ?? log.blockId,
    type: log.blockType,
    duration: log.durationMs,
    startTime: log.startedAt,
    endTime: log.endedAt,
    status: log.error ? 'error' : 'success',
    children: [],
    blockId: log.blockId,
    executionOrder: log.executionOrder,
    input: log.input,
    output,
    ...(childIds ?? {}),
    ...(log.errorHandled && { errorHandled: true }),
    ...(log.loopId && { loopId: log.loopId }),
    ...(log.parallelId && { parallelId: log.parallelId }),
    ...(log.iterationIndex !== undefined && { iterationIndex: log.iterationIndex }),
    ...(log.parentIterations?.length && { parentIterations: log.parentIterations }),
  }
}

/**
 * Strips internal fields from the block output for display and merges
 * the block-level error into output so the UI renders it alongside data.
 */
function extractDisplayOutput(log: ValidBlockLog): Record<string, unknown> {
  const { childWorkflowSnapshotId, childWorkflowId, ...rest } = log.output ?? {}
  return log.error ? { ...rest, error: log.error } : rest
}

/** Pulls child-workflow identifiers off the output so they can live on the span. */
function extractChildWorkflowIds(
  output: NormalizedBlockOutput | undefined
): { childWorkflowSnapshotId?: string; childWorkflowId?: string } | undefined {
  if (!output) return undefined
  const ids: { childWorkflowSnapshotId?: string; childWorkflowId?: string } = {}
  if (typeof output.childWorkflowSnapshotId === 'string') {
    ids.childWorkflowSnapshotId = output.childWorkflowSnapshotId
  }
  if (typeof output.childWorkflowId === 'string') {
    ids.childWorkflowId = output.childWorkflowId
  }
  return ids.childWorkflowSnapshotId || ids.childWorkflowId ? ids : undefined
}

/** Enriches a span with provider timing, cost, tokens, and model from block output. */
function enrichWithProviderMetadata(span: TraceSpan, log: ValidBlockLog): void {
  const output = log.output
  if (!output) return

  if (output.providerTiming) {
    const pt = output.providerTiming
    const timing: ProviderTiming = {
      duration: pt.duration,
      startTime: pt.startTime,
      endTime: pt.endTime,
      segments: pt.timeSegments ?? [],
    }
    span.providerTiming = timing
  }

  if (output.cost) {
    const { input, output: out, total, toolCost } = output.cost
    span.cost = {
      input,
      output: out,
      total,
      ...(typeof toolCost === 'number' && toolCost > 0 ? { toolCost } : {}),
    }
  }

  if (output.tokens) {
    const t = output.tokens
    const input =
      typeof t.input === 'number' ? t.input : typeof t.prompt === 'number' ? t.prompt : undefined
    const outputTokens =
      typeof t.output === 'number'
        ? t.output
        : typeof t.completion === 'number'
          ? t.completion
          : undefined
    const totalExplicit = typeof t.total === 'number' ? t.total : undefined
    const total =
      totalExplicit ??
      (input !== undefined || outputTokens !== undefined
        ? (input ?? 0) + (outputTokens ?? 0)
        : undefined)
    span.tokens = {
      ...(input !== undefined && { input }),
      ...(outputTokens !== undefined && { output: outputTokens }),
      ...(total !== undefined && { total }),
    }
  }

  if (typeof output.model === 'string') {
    span.model = output.model
  }
}

/**
 * Builds child spans from provider `timeSegments`, matching tool segments to
 * their corresponding tool call I/O by name in sequential order.
 */
function buildChildrenFromTimeSegments(
  span: TraceSpan,
  log: ValidBlockLog,
  segments: ProviderTimingSegment[]
): TraceSpan[] {
  const toolCallsByName = groupToolCallsByName(resolveToolCallsList(log.output))
  const toolCallIndices = new Map<string, number>()

  return segments.map((segment, index) => {
    const segmentStartTime = new Date(segment.startTime).toISOString()
    let segmentEndTime = new Date(segment.endTime).toISOString()
    let segmentDuration = segment.duration

    // The final model segment sometimes closes before the block ends (e.g. when
    // post-processing runs after the stream). Extend it to the block endTime so
    // the Gantt bar fills to the edge rather than leaving a trailing gap.
    if (index === segments.length - 1 && segment.type === 'model' && log.endedAt) {
      const blockEndMs = new Date(log.endedAt).getTime()
      const segmentEndMs = new Date(segment.endTime).getTime()
      if (blockEndMs > segmentEndMs) {
        segmentEndTime = log.endedAt
        segmentDuration = blockEndMs - new Date(segment.startTime).getTime()
      }
    }

    if (segment.type === 'tool') {
      const normalizedName = stripCustomToolPrefix(segment.name ?? '')
      const callsForName = toolCallsByName.get(normalizedName) ?? []
      const currentIndex = toolCallIndices.get(normalizedName) ?? 0
      const match = callsForName[currentIndex]
      toolCallIndices.set(normalizedName, currentIndex + 1)

      const toolChild: TraceSpan = {
        id: `${span.id}-segment-${index}`,
        name: normalizedName,
        type: 'tool',
        duration: segment.duration,
        startTime: segmentStartTime,
        endTime: segmentEndTime,
        status: match?.error || segment.errorMessage ? 'error' : 'success',
        input: match?.arguments ?? match?.input,
        output: match?.error
          ? { error: match.error, ...(match.result ?? match.output ?? {}) }
          : (match?.result ?? match?.output),
      }
      if (segment.toolCallId) toolChild.toolCallId = segment.toolCallId
      if (segment.errorType) toolChild.errorType = segment.errorType
      if (segment.errorMessage) toolChild.errorMessage = segment.errorMessage
      return toolChild
    }

    const modelChild: TraceSpan = {
      id: `${span.id}-segment-${index}`,
      name: segment.name ?? 'Model',
      type: 'model',
      duration: segmentDuration,
      startTime: segmentStartTime,
      endTime: segmentEndTime,
      status: segment.errorMessage ? 'error' : 'success',
    }

    if (segment.assistantContent) {
      modelChild.output = { content: segment.assistantContent }
    }
    if (segment.thinkingContent) {
      modelChild.thinking = segment.thinkingContent
    }
    if (segment.toolCalls && segment.toolCalls.length > 0) {
      modelChild.modelToolCalls = segment.toolCalls
    }
    if (segment.finishReason) {
      modelChild.finishReason = segment.finishReason
    }
    if (segment.tokens) {
      modelChild.tokens = segment.tokens
    }
    if (segment.cost) {
      modelChild.cost = segment.cost
    }
    if (typeof segment.ttft === 'number' && segment.ttft >= 0) {
      modelChild.ttft = segment.ttft
    }
    if (span.model) {
      modelChild.model = span.model
    }
    if (segment.provider) {
      modelChild.provider = segment.provider
    }
    if (segment.errorType) {
      modelChild.errorType = segment.errorType
    }
    if (segment.errorMessage) {
      modelChild.errorMessage = segment.errorMessage
    }

    return modelChild
  })
}

/**
 * Builds tool-call child spans when the provider did not emit `timeSegments`.
 * Each tool call becomes a full TraceSpan of `type: 'tool'`.
 */
function buildChildrenFromToolCalls(span: TraceSpan, log: ValidBlockLog): TraceSpan[] {
  const toolCalls = resolveToolCallsList(log.output)
  if (toolCalls.length === 0) return []

  return toolCalls.map((tc, index) => {
    const startTime = tc.startTime ?? log.startedAt
    const endTime = tc.endTime ?? log.endedAt
    return {
      id: `${span.id}-tool-${index}`,
      name: stripCustomToolPrefix(tc.name ?? 'unnamed-tool'),
      type: 'tool',
      duration: tc.duration ?? 0,
      startTime,
      endTime,
      status: tc.error ? 'error' : 'success',
      input: tc.arguments ?? tc.input,
      output: tc.error
        ? { error: tc.error, ...(tc.result ?? tc.output ?? {}) }
        : (tc.result ?? tc.output),
    }
  })
}

/** Groups tool calls by their stripped name for sequential matching against segments. */
function groupToolCallsByName(toolCalls: BlockToolCall[]): Map<string, BlockToolCall[]> {
  const byName = new Map<string, BlockToolCall[]>()
  for (const tc of toolCalls) {
    const name = stripCustomToolPrefix(tc.name ?? '')
    const list = byName.get(name)
    if (list) list.push(tc)
    else byName.set(name, [tc])
  }
  return byName
}

/**
 * Resolves the tool calls list from block output. Providers write a normalized
 * `{list, count}` container; a legacy streaming path embeds calls under
 * `executionData.output.toolCalls`. The `Array.isArray` branches guard against
 * persisted logs from before the container shape was normalized, where
 * `toolCalls` was stored as a plain array — still observed in older DB rows.
 */
function resolveToolCallsList(output: NormalizedBlockOutput | undefined): BlockToolCall[] {
  if (!output) return []

  const direct = output.toolCalls
  if (direct) {
    if (Array.isArray(direct)) return direct
    if (direct.list) return direct.list
    logger.warn('Unexpected toolCalls shape on block output — no list extracted', {
      shape: typeof direct,
    })
    return []
  }

  const legacy = (output.executionData as { output?: { toolCalls?: unknown } } | undefined)?.output
    ?.toolCalls
  if (!legacy) return []
  if (Array.isArray(legacy)) return legacy as BlockToolCall[]
  if (typeof legacy === 'object' && legacy !== null && 'list' in legacy) {
    return ((legacy as { list?: BlockToolCall[] }).list ?? []) as BlockToolCall[]
  }
  logger.warn('Unexpected legacy executionData.output.toolCalls shape — no list extracted', {
    shape: typeof legacy,
  })
  return []
}

/** Extracts and flattens child workflow trace spans into the parent span's children. */
function attachChildWorkflowSpans(span: TraceSpan, log: ValidBlockLog): void {
  const childTraceSpans = log.childTraceSpans ?? log.output?.childTraceSpans
  if (!childTraceSpans?.length) return

  span.children = flattenWorkflowChildren(childTraceSpans)
  span.output = stripChildTraceSpansFromOutput(span.output)
}

/** True when a span is a synthetic workflow wrapper (no blockId). */
function isSyntheticWorkflowWrapper(span: TraceSpan): boolean {
  return span.type === 'workflow' && !span.blockId
}

/** Reads nested `childTraceSpans` off a span's output, or `[]` if absent. */
function extractOutputChildren(output: TraceSpan['output']): TraceSpan[] {
  const nested = (output as { childTraceSpans?: TraceSpan[] } | undefined)?.childTraceSpans
  return Array.isArray(nested) ? nested : []
}

/** Returns a copy of `output` with `childTraceSpans` removed, or undefined unchanged. */
function stripChildTraceSpansFromOutput(
  output: TraceSpan['output']
): TraceSpan['output'] | undefined {
  if (!output || !('childTraceSpans' in output)) return output
  const { childTraceSpans: _, ...rest } = output as Record<string, unknown>
  return rest
}

/** Recursively flattens synthetic workflow wrappers, preserving real block spans. */
function flattenWorkflowChildren(spans: TraceSpan[]): TraceSpan[] {
  const flattened: TraceSpan[] = []

  for (const span of spans) {
    if (isSyntheticWorkflowWrapper(span)) {
      if (span.children?.length) {
        flattened.push(...flattenWorkflowChildren(span.children))
      }
      continue
    }

    const directChildren = span.children ?? []
    const outputChildren = extractOutputChildren(span.output)
    const allChildren = [...directChildren, ...outputChildren]

    const nextSpan: TraceSpan = { ...span }
    if (allChildren.length > 0) {
      nextSpan.children = flattenWorkflowChildren(allChildren)
    }
    if (outputChildren.length > 0) {
      nextSpan.output = stripChildTraceSpansFromOutput(nextSpan.output)
    }

    flattened.push(nextSpan)
  }

  return flattened
}
