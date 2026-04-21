import { createLogger } from '@sim/logger'
import type { ToolCall, TraceSpan } from '@/lib/logs/types'
import {
  isConditionBlockType,
  isWorkflowBlockType,
  stripCustomToolPrefix,
} from '@/executor/constants'
import type { ExecutionResult } from '@/executor/types'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'

const logger = createLogger('TraceSpans')

/**
 * Keys that should be recursively filtered from output display.
 * These are internal fields used for execution tracking that shouldn't be shown to users.
 */
const HIDDEN_OUTPUT_KEYS = new Set(['childTraceSpans'])

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

function isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
  if (!span || span.type !== 'workflow') return false
  return !span.blockId
}

function flattenWorkflowChildren(spans: TraceSpan[]): TraceSpan[] {
  const flattened: TraceSpan[] = []

  spans.forEach((span) => {
    if (isSyntheticWorkflowWrapper(span)) {
      if (span.children && Array.isArray(span.children)) {
        flattened.push(...flattenWorkflowChildren(span.children))
      }
      return
    }

    const processedSpan: TraceSpan = { ...span }

    const directChildren = Array.isArray(span.children) ? span.children : []
    const outputChildren =
      span.output &&
      typeof span.output === 'object' &&
      Array.isArray((span.output as { childTraceSpans?: TraceSpan[] }).childTraceSpans)
        ? ((span.output as { childTraceSpans?: TraceSpan[] }).childTraceSpans as TraceSpan[])
        : []

    const allChildren = [...directChildren, ...outputChildren]
    if (allChildren.length > 0) {
      processedSpan.children = flattenWorkflowChildren(allChildren)
    }

    if (outputChildren.length > 0 && processedSpan.output) {
      const { childTraceSpans: _, ...cleanOutput } = processedSpan.output as {
        childTraceSpans?: TraceSpan[]
      } & Record<string, unknown>
      processedSpan.output = cleanOutput
    }

    flattened.push(processedSpan)
  })

  return flattened
}

export function buildTraceSpans(result: ExecutionResult): {
  traceSpans: TraceSpan[]
  totalDuration: number
} {
  if (!result.logs || result.logs.length === 0) {
    return { traceSpans: [], totalDuration: 0 }
  }

  const spanMap = new Map<string, TraceSpan>()

  const parentChildMap = new Map<string, string>()

  type Connection = { source: string; target: string }
  const workflowConnections: Connection[] = result.metadata?.workflowConnections || []
  if (workflowConnections.length > 0) {
    workflowConnections.forEach((conn: Connection) => {
      if (conn.source && conn.target) {
        parentChildMap.set(conn.target, conn.source)
      }
    })
  }

  result.logs.forEach((log) => {
    if (!log.blockId || !log.blockType) return

    const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
    const isCondition = isConditionBlockType(log.blockType)

    const duration = log.durationMs || 0

    let output = log.output || {}
    let childWorkflowSnapshotId: string | undefined
    let childWorkflowId: string | undefined

    if (output && typeof output === 'object') {
      const outputRecord = output as Record<string, unknown>
      childWorkflowSnapshotId =
        typeof outputRecord.childWorkflowSnapshotId === 'string'
          ? outputRecord.childWorkflowSnapshotId
          : undefined
      childWorkflowId =
        typeof outputRecord.childWorkflowId === 'string' ? outputRecord.childWorkflowId : undefined
      if (childWorkflowSnapshotId || childWorkflowId) {
        const {
          childWorkflowSnapshotId: _childSnapshotId,
          childWorkflowId: _childWorkflowId,
          ...outputRest
        } = outputRecord
        output = outputRest
      }
    }

    if (log.error) {
      output = {
        ...output,
        error: log.error,
      }
    }

    const displayName = log.blockName || log.blockId

    const span: TraceSpan = {
      id: spanId,
      name: displayName,
      type: log.blockType,
      duration: duration,
      startTime: log.startedAt,
      endTime: log.endedAt,
      status: log.error ? 'error' : 'success',
      children: [],
      blockId: log.blockId,
      input: log.input || {},
      output: output,
      ...(childWorkflowSnapshotId ? { childWorkflowSnapshotId } : {}),
      ...(childWorkflowId ? { childWorkflowId } : {}),
      ...(log.errorHandled && { errorHandled: true }),
      ...(log.loopId && { loopId: log.loopId }),
      ...(log.parallelId && { parallelId: log.parallelId }),
      ...(log.iterationIndex !== undefined && { iterationIndex: log.iterationIndex }),
      ...(log.parentIterations?.length && { parentIterations: log.parentIterations }),
    }

    if (!isCondition && log.output?.providerTiming) {
      const providerTiming = log.output.providerTiming as {
        duration: number
        startTime: string
        endTime: string
        timeSegments?: Array<{
          type: string
          name?: string
          startTime: string | number
          endTime: string | number
          duration: number
        }>
      }

      span.providerTiming = {
        duration: providerTiming.duration,
        startTime: providerTiming.startTime,
        endTime: providerTiming.endTime,
        segments: providerTiming.timeSegments || [],
      }
    }

    if (!isCondition && log.output?.cost) {
      span.cost = log.output.cost as {
        input?: number
        output?: number
        total?: number
      }
    }

    if (!isCondition && log.output?.tokens) {
      const t = log.output.tokens as
        | number
        | {
            input?: number
            output?: number
            total?: number
            prompt?: number
            completion?: number
          }
      if (typeof t === 'number') {
        span.tokens = t
      } else if (typeof t === 'object') {
        const input = t.input ?? t.prompt
        const output = t.output ?? t.completion
        const total =
          t.total ??
          (typeof input === 'number' || typeof output === 'number'
            ? (input || 0) + (output || 0)
            : undefined)
        span.tokens = {
          ...(typeof input === 'number' ? { input } : {}),
          ...(typeof output === 'number' ? { output } : {}),
          ...(typeof total === 'number' ? { total } : {}),
        }
      } else {
        span.tokens = t
      }
    }

    if (!isCondition && log.output?.model) {
      span.model = log.output.model as string
    }

    if (
      !isWorkflowBlockType(log.blockType) &&
      !isCondition &&
      log.output?.providerTiming?.timeSegments &&
      Array.isArray(log.output.providerTiming.timeSegments)
    ) {
      const timeSegments = log.output.providerTiming.timeSegments
      const toolCallsData = log.output?.toolCalls?.list || log.output?.toolCalls || []

      const toolCallsByName = new Map<string, Array<Record<string, unknown>>>()
      for (const tc of toolCallsData as Array<{ name?: string; [key: string]: unknown }>) {
        const normalizedName = stripCustomToolPrefix(tc.name || '')
        if (!toolCallsByName.has(normalizedName)) {
          toolCallsByName.set(normalizedName, [])
        }
        toolCallsByName.get(normalizedName)!.push(tc)
      }

      const toolCallIndices = new Map<string, number>()

      span.children = timeSegments.map(
        (
          segment: {
            type: string
            name?: string
            startTime: string | number
            endTime: string | number
            duration: number
          },
          index: number
        ) => {
          const segmentStartTime = new Date(segment.startTime).toISOString()
          let segmentEndTime = new Date(segment.endTime).toISOString()
          let segmentDuration = segment.duration

          if (segment.name?.toLowerCase().includes('streaming') && log.endedAt) {
            const blockEndTime = new Date(log.endedAt).getTime()
            const segmentEndTimeMs = new Date(segment.endTime).getTime()

            if (blockEndTime > segmentEndTimeMs) {
              segmentEndTime = log.endedAt
              segmentDuration = blockEndTime - new Date(segment.startTime).getTime()
            }
          }

          if (segment.type === 'tool') {
            const normalizedName = stripCustomToolPrefix(segment.name || '')

            const toolCallsForName = toolCallsByName.get(normalizedName) || []
            const currentIndex = toolCallIndices.get(normalizedName) || 0
            const matchingToolCall = toolCallsForName[currentIndex] as
              | {
                  error?: string
                  arguments?: Record<string, unknown>
                  input?: Record<string, unknown>
                  result?: Record<string, unknown>
                  output?: Record<string, unknown>
                }
              | undefined

            toolCallIndices.set(normalizedName, currentIndex + 1)

            return {
              id: `${span.id}-segment-${index}`,
              name: normalizedName,
              type: 'tool',
              duration: segment.duration,
              startTime: segmentStartTime,
              endTime: segmentEndTime,
              status: matchingToolCall?.error ? 'error' : 'success',
              input: matchingToolCall?.arguments || matchingToolCall?.input,
              output: matchingToolCall?.error
                ? {
                    error: matchingToolCall.error,
                    ...(matchingToolCall.result || matchingToolCall.output || {}),
                  }
                : matchingToolCall?.result || matchingToolCall?.output,
            }
          }
          return {
            id: `${span.id}-segment-${index}`,
            name: segment.name,
            type: 'model',
            duration: segmentDuration,
            startTime: segmentStartTime,
            endTime: segmentEndTime,
            status: 'success',
          }
        }
      )
    } else if (!isCondition) {
      let toolCallsList = null

      try {
        if (log.output?.toolCalls?.list) {
          toolCallsList = log.output.toolCalls.list
        } else if (Array.isArray(log.output?.toolCalls)) {
          toolCallsList = log.output.toolCalls
        } else if (log.output?.executionData?.output?.toolCalls) {
          const tcObj = log.output.executionData.output.toolCalls
          toolCallsList = Array.isArray(tcObj) ? tcObj : tcObj.list || []
        }

        if (toolCallsList && !Array.isArray(toolCallsList)) {
          logger.warn(`toolCallsList is not an array: ${typeof toolCallsList}`, {
            blockId: log.blockId,
            blockType: log.blockType,
          })
          toolCallsList = []
        }
      } catch (error) {
        logger.error(`Error extracting toolCalls from block ${log.blockId}:`, error)
        toolCallsList = []
      }

      if (toolCallsList && toolCallsList.length > 0) {
        const processedToolCalls: ToolCall[] = []

        for (const tc of toolCallsList as Array<{
          name?: string
          duration?: number
          startTime?: string
          endTime?: string
          error?: string
          arguments?: Record<string, unknown>
          input?: Record<string, unknown>
          result?: Record<string, unknown>
          output?: Record<string, unknown>
        }>) {
          if (!tc) continue

          try {
            const toolCall: ToolCall = {
              name: stripCustomToolPrefix(tc.name || 'unnamed-tool'),
              duration: tc.duration || 0,
              startTime: tc.startTime || log.startedAt,
              endTime: tc.endTime || log.endedAt,
              status: tc.error ? 'error' : 'success',
            }

            if (tc.arguments || tc.input) {
              toolCall.input = tc.arguments || tc.input
            }

            if (tc.result || tc.output) {
              toolCall.output = tc.result || tc.output
            }

            if (tc.error) {
              toolCall.error = tc.error
            }

            processedToolCalls.push(toolCall)
          } catch (tcError) {
            logger.error(`Error processing tool call in block ${log.blockId}:`, tcError)
          }
        }

        span.toolCalls = processedToolCalls
      }
    }

    if (isWorkflowBlockType(log.blockType)) {
      const childTraceSpans = Array.isArray(log.childTraceSpans)
        ? log.childTraceSpans
        : Array.isArray(log.output?.childTraceSpans)
          ? (log.output.childTraceSpans as TraceSpan[])
          : null

      if (childTraceSpans) {
        const flattenedChildren = flattenWorkflowChildren(childTraceSpans)
        span.children = flattenedChildren

        if (span.output && typeof span.output === 'object' && 'childTraceSpans' in span.output) {
          const { childTraceSpans: _, ...cleanOutput } = span.output as {
            childTraceSpans?: TraceSpan[]
          } & Record<string, unknown>
          span.output = cleanOutput
        }
      }
    }

    spanMap.set(spanId, span)
  })

  const sortedLogs = [...result.logs].sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime()
    const bTime = new Date(b.startedAt).getTime()
    return aTime - bTime
  })

  const rootSpans: TraceSpan[] = []

  sortedLogs.forEach((log) => {
    if (!log.blockId) return

    const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
    const span = spanMap.get(spanId)
    if (span) {
      rootSpans.push(span)
    }
  })

  if (rootSpans.length === 0 && workflowConnections.length === 0) {
    const spanStack: TraceSpan[] = []

    sortedLogs.forEach((log) => {
      if (!log.blockId || !log.blockType) return

      const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
      const span = spanMap.get(spanId)
      if (!span) return

      if (spanStack.length > 0) {
        const potentialParent = spanStack[spanStack.length - 1]
        const parentStartTime = new Date(potentialParent.startTime).getTime()
        const parentEndTime = new Date(potentialParent.endTime).getTime()
        const spanStartTime = new Date(span.startTime).getTime()

        if (spanStartTime >= parentStartTime && spanStartTime <= parentEndTime) {
          if (!potentialParent.children) potentialParent.children = []
          potentialParent.children.push(span)
        } else {
          while (
            spanStack.length > 0 &&
            new Date(spanStack[spanStack.length - 1].endTime).getTime() < spanStartTime
          ) {
            spanStack.pop()
          }

          if (spanStack.length > 0) {
            const newParent = spanStack[spanStack.length - 1]
            if (!newParent.children) newParent.children = []
            newParent.children.push(span)
          } else {
            rootSpans.push(span)
          }
        }
      } else {
        rootSpans.push(span)
      }

      if (log.blockType === 'agent' || isWorkflowBlockType(log.blockType)) {
        spanStack.push(span)
      }
    })
  }

  const groupedRootSpans = groupIterationBlocks(rootSpans)

  const totalDuration = groupedRootSpans.reduce((sum, span) => sum + span.duration, 0)

  if (groupedRootSpans.length > 0 && result.metadata) {
    const allSpansList = Array.from(spanMap.values())

    const earliestStart = allSpansList.reduce((earliest, span) => {
      const startTime = new Date(span.startTime).getTime()
      return startTime < earliest ? startTime : earliest
    }, Number.POSITIVE_INFINITY)

    const latestEnd = allSpansList.reduce((latest, span) => {
      const endTime = new Date(span.endTime).getTime()
      return endTime > latest ? endTime : latest
    }, 0)

    const actualWorkflowDuration = latestEnd - earliestStart

    const addRelativeTimestamps = (spans: TraceSpan[], workflowStartMs: number) => {
      spans.forEach((span) => {
        span.relativeStartMs = new Date(span.startTime).getTime() - workflowStartMs
        if (span.children && span.children.length > 0) {
          addRelativeTimestamps(span.children, workflowStartMs)
        }
      })
    }
    addRelativeTimestamps(groupedRootSpans, earliestStart)

    const checkForUnhandledErrors = (s: TraceSpan): boolean => {
      if (s.status === 'error' && !s.errorHandled) return true
      return s.children ? s.children.some(checkForUnhandledErrors) : false
    }
    const hasUnhandledErrors = groupedRootSpans.some(checkForUnhandledErrors)

    const workflowSpan: TraceSpan = {
      id: 'workflow-execution',
      name: 'Workflow Execution',
      type: 'workflow',
      duration: actualWorkflowDuration, // Always use actual duration for the span
      startTime: new Date(earliestStart).toISOString(),
      endTime: new Date(latestEnd).toISOString(),
      status: hasUnhandledErrors ? 'error' : 'success',
      children: groupedRootSpans,
    }

    return { traceSpans: [workflowSpan], totalDuration: actualWorkflowDuration }
  }

  return { traceSpans: groupedRootSpans, totalDuration }
}

/**
 * Builds a container-level TraceSpan (iteration wrapper or top-level container)
 * from its source spans and resolved children.
 */
function buildContainerSpan(opts: {
  id: string
  name: string
  type: string
  sourceSpans: TraceSpan[]
  children: TraceSpan[]
}): TraceSpan {
  const startTimes = opts.sourceSpans.map((s) => new Date(s.startTime).getTime())
  const endTimes = opts.sourceSpans.map((s) => new Date(s.endTime).getTime())
  const earliestStart = Math.min(...startTimes)
  const latestEnd = Math.max(...endTimes)

  const hasErrors = opts.sourceSpans.some((s) => s.status === 'error')
  const allErrorsHandled =
    hasErrors && opts.children.every((s) => s.status !== 'error' || s.errorHandled)

  return {
    id: opts.id,
    name: opts.name,
    type: opts.type,
    duration: latestEnd - earliestStart,
    startTime: new Date(earliestStart).toISOString(),
    endTime: new Date(latestEnd).toISOString(),
    status: hasErrors ? 'error' : 'success',
    ...(allErrorsHandled && { errorHandled: true }),
    children: opts.children,
  }
}

/** Counter state for generating sequential container names. */
interface ContainerNameCounters {
  loopNumbers: Map<string, number>
  parallelNumbers: Map<string, number>
  loopCounter: number
  parallelCounter: number
}

/**
 * Resolves a container name from normal (non-iteration) spans or assigns a sequential number.
 * Strips clone suffixes so all clones of the same container share one name/number.
 */
function resolveContainerName(
  containerId: string,
  containerType: 'parallel' | 'loop',
  normalSpans: TraceSpan[],
  counters: ContainerNameCounters
): string {
  const originalId = stripCloneSuffixes(containerId)

  const matchingBlock = normalSpans.find(
    (s) => s.blockId === originalId && s.type === containerType
  )
  if (matchingBlock?.name) return matchingBlock.name

  if (containerType === 'parallel') {
    if (!counters.parallelNumbers.has(originalId)) {
      counters.parallelNumbers.set(originalId, counters.parallelCounter++)
    }
    return `Parallel ${counters.parallelNumbers.get(originalId)}`
  }
  if (!counters.loopNumbers.has(originalId)) {
    counters.loopNumbers.set(originalId, counters.loopCounter++)
  }
  return `Loop ${counters.loopNumbers.get(originalId)}`
}

/**
 * Classifies a span's immediate container ID and type from its metadata.
 * Returns undefined for non-iteration spans.
 */
function classifySpanContainer(
  span: TraceSpan
): { containerId: string; containerType: 'parallel' | 'loop' } | undefined {
  if (span.parallelId) {
    return { containerId: span.parallelId, containerType: 'parallel' }
  }
  if (span.loopId) {
    return { containerId: span.loopId, containerType: 'loop' }
  }
  // Fallback: parse from blockId for legacy data
  if (span.blockId?.includes('_parallel_')) {
    const match = span.blockId.match(/_parallel_([^_]+)_iteration_/)
    if (match) {
      return { containerId: match[1], containerType: 'parallel' }
    }
  }
  return undefined
}

/**
 * Finds the outermost container for a span. For nested spans, this is parentIterations[0].
 * For flat spans, this is the span's own immediate container.
 */
function getOutermostContainer(
  span: TraceSpan
): { containerId: string; containerType: 'parallel' | 'loop' } | undefined {
  if (span.parentIterations && span.parentIterations.length > 0) {
    const outermost = span.parentIterations[0]
    return {
      containerId: outermost.iterationContainerId,
      containerType: outermost.iterationType as 'parallel' | 'loop',
    }
  }
  return classifySpanContainer(span)
}

/**
 * Builds the iteration-level hierarchy for a container, recursively nesting
 * any deeper subflows. Works with both:
 * - Direct spans (spans whose immediate container matches)
 * - Nested spans (spans with parentIterations pointing through this container)
 */
function buildContainerChildren(
  containerType: 'parallel' | 'loop',
  containerId: string,
  spans: TraceSpan[],
  normalSpans: TraceSpan[],
  counters: ContainerNameCounters
): TraceSpan[] {
  const iterationType = containerType === 'parallel' ? 'parallel-iteration' : 'loop-iteration'

  // Group spans by iteration index at this level.
  // Each span's iteration index at this level comes from:
  // - parentIterations[0].iterationCurrent if parentIterations[0].containerId === containerId
  // - span.iterationIndex if span's immediate container === containerId
  const iterationGroups = new Map<number, TraceSpan[]>()

  for (const span of spans) {
    let iterIdx: number | undefined

    if (
      span.parentIterations &&
      span.parentIterations.length > 0 &&
      span.parentIterations[0].iterationContainerId === containerId
    ) {
      iterIdx = span.parentIterations[0].iterationCurrent
    } else {
      // The span's immediate container is this container
      iterIdx = span.iterationIndex
    }

    if (iterIdx === undefined) continue

    if (!iterationGroups.has(iterIdx)) iterationGroups.set(iterIdx, [])
    iterationGroups.get(iterIdx)!.push(span)
  }

  const iterationChildren: TraceSpan[] = []
  const sortedIterations = Array.from(iterationGroups.entries()).sort(([a], [b]) => a - b)

  for (const [iterationIndex, iterSpans] of sortedIterations) {
    // For each span in this iteration, strip one level of ancestry and determine
    // whether it belongs to this container directly or to a deeper subflow
    const directLeaves: TraceSpan[] = []
    const deeperSpans: TraceSpan[] = []

    for (const span of iterSpans) {
      if (
        span.parentIterations &&
        span.parentIterations.length > 0 &&
        span.parentIterations[0].iterationContainerId === containerId
      ) {
        // Strip the outermost parentIteration (this container level)
        deeperSpans.push({
          ...span,
          parentIterations: span.parentIterations.slice(1),
        })
      } else {
        // This span's immediate container IS this container — it's a direct leaf
        directLeaves.push({
          ...span,
          name: span.name.replace(/ \(iteration \d+\)$/, ''),
        })
      }
    }

    // Recursively group the deeper spans (they'll form nested containers)
    const nestedResult = groupIterationBlocksRecursive(
      [...directLeaves, ...deeperSpans],
      normalSpans,
      counters
    )

    iterationChildren.push(
      buildContainerSpan({
        id: `${containerId}-iteration-${iterationIndex}`,
        name: `Iteration ${iterationIndex}`,
        type: iterationType,
        sourceSpans: iterSpans,
        children: nestedResult,
      })
    )
  }

  return iterationChildren
}

/**
 * Core recursive algorithm for grouping iteration blocks.
 *
 * Handles two cases:
 * 1. **Flat** (backward compat): spans have loopId/parallelId + iterationIndex but no
 *    parentIterations. Grouped by immediate container → iteration → leaf.
 * 2. **Nested** (new): spans have parentIterations chains. The outermost ancestor in the
 *    chain determines the top-level container. Iteration spans are peeled one level at a
 *    time and recursed.
 *
 * Container BlockLogs (parallel/loop) are produced on skip (empty collection), error, and
 * successful completion. When present, they supply the user-configured container name via
 * `resolveContainerName`; otherwise the container is synthesized from iteration data with a
 * counter-based fallback name.
 */
function groupIterationBlocksRecursive(
  spans: TraceSpan[],
  normalSpans: TraceSpan[],
  counters: ContainerNameCounters
): TraceSpan[] {
  const result: TraceSpan[] = []
  const iterationSpans: TraceSpan[] = []
  const nonIterationSpans: TraceSpan[] = []

  for (const span of spans) {
    if (
      span.name.match(/^(.+) \(iteration (\d+)\)$/) ||
      (span.parentIterations && span.parentIterations.length > 0)
    ) {
      iterationSpans.push(span)
    } else {
      nonIterationSpans.push(span)
    }
  }

  const containerIdsWithIterations = new Set<string>()
  for (const span of iterationSpans) {
    const outermost = getOutermostContainer(span)
    if (outermost) containerIdsWithIterations.add(outermost.containerId)
  }

  const nonContainerSpans = nonIterationSpans.filter(
    (span) =>
      (span.type !== 'parallel' && span.type !== 'loop') ||
      span.status === 'error' ||
      (span.blockId && !containerIdsWithIterations.has(span.blockId))
  )

  if (iterationSpans.length === 0) {
    result.push(...nonContainerSpans)
    result.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    return result
  }

  // Group iteration spans by outermost container
  const containerGroups = new Map<
    string,
    { type: 'parallel' | 'loop'; containerId: string; containerName: string; spans: TraceSpan[] }
  >()

  for (const span of iterationSpans) {
    const outermost = getOutermostContainer(span)
    if (!outermost) continue

    const { containerId, containerType } = outermost
    const groupKey = `${containerType}_${containerId}`

    if (!containerGroups.has(groupKey)) {
      const containerName = resolveContainerName(containerId, containerType, normalSpans, counters)
      containerGroups.set(groupKey, {
        type: containerType,
        containerId,
        containerName,
        spans: [],
      })
    }
    containerGroups.get(groupKey)!.spans.push(span)
  }

  // Build each container with recursive nesting
  for (const [, group] of containerGroups) {
    const { type, containerId, containerName, spans: containerSpans } = group

    const iterationChildren = buildContainerChildren(
      type,
      containerId,
      containerSpans,
      normalSpans,
      counters
    )

    result.push(
      buildContainerSpan({
        id: `${type === 'parallel' ? 'parallel' : 'loop'}-execution-${containerId}`,
        name: containerName,
        type,
        sourceSpans: containerSpans,
        children: iterationChildren,
      })
    )
  }

  result.push(...nonContainerSpans)
  result.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

  return result
}

/**
 * Groups iteration-based blocks (parallel and loop) by organizing their iteration spans
 * into a hierarchical structure with proper parent-child relationships.
 * Supports recursive nesting via parentIterations (e.g., parallel-in-parallel, loop-in-loop).
 *
 * @param spans - Array of root spans to process
 * @returns Array of spans with iteration blocks properly grouped
 */
function groupIterationBlocks(spans: TraceSpan[]): TraceSpan[] {
  const normalSpans = spans.filter((s) => !s.name.match(/^(.+) \(iteration (\d+)\)$/))
  const counters: ContainerNameCounters = {
    loopNumbers: new Map<string, number>(),
    parallelNumbers: new Map<string, number>(),
    loopCounter: 1,
    parallelCounter: 1,
  }
  return groupIterationBlocksRecursive(spans, normalSpans, counters)
}
