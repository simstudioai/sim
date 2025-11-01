import { createLogger } from '@/lib/logs/console/logger'
import type { ToolCall, TraceSpan } from '@/lib/logs/types'
import { isWorkflowBlockType } from '@/executor/consts'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('TraceSpans')

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

    const processedSpan = ensureNestedWorkflowsProcessed(span)
    flattened.push(processedSpan)
  })

  return flattened
}

function getTraceSpanKey(span: TraceSpan): string {
  if (span.id) {
    return span.id
  }

  const name = span.name || 'span'
  const start = span.startTime || 'unknown-start'
  const end = span.endTime || 'unknown-end'

  return `${name}|${start}|${end}`
}

function mergeTraceSpanChildren(...childGroups: TraceSpan[][]): TraceSpan[] {
  const merged: TraceSpan[] = []
  const seen = new Set<string>()

  childGroups.forEach((group) => {
    group.forEach((child) => {
      const key = getTraceSpanKey(child)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push(child)
    })
  })

  return merged
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

    const duration = log.durationMs || 0

    let output = log.output || {}

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
      ...(log.loopId && { loopId: log.loopId }),
      ...(log.parallelId && { parallelId: log.parallelId }),
      ...(log.iterationIndex !== undefined && { iterationIndex: log.iterationIndex }),
    }

    if (log.output?.providerTiming) {
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

    if (log.output?.cost) {
      span.cost = log.output.cost as {
        input?: number
        output?: number
        total?: number
      }
    }

    if (log.output?.tokens) {
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

    if (log.output?.model) {
      span.model = log.output.model as string
    }

    if (
      !isWorkflowBlockType(log.blockType) &&
      log.output?.providerTiming?.timeSegments &&
      Array.isArray(log.output.providerTiming.timeSegments)
    ) {
      const timeSegments = log.output.providerTiming.timeSegments
      const toolCallsData = log.output?.toolCalls?.list || log.output?.toolCalls || []

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
            const matchingToolCall = toolCallsData.find(
              (tc: { name?: string; [key: string]: unknown }) =>
                tc.name === segment.name || stripCustomToolPrefix(tc.name || '') === segment.name
            )

            return {
              id: `${span.id}-segment-${index}`,
              name: stripCustomToolPrefix(segment.name || ''),
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
    } else {
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

    if (
      isWorkflowBlockType(log.blockType) &&
      log.output?.childTraceSpans &&
      Array.isArray(log.output.childTraceSpans)
    ) {
      const childTraceSpans = log.output.childTraceSpans as TraceSpan[]
      const flattenedChildren = flattenWorkflowChildren(childTraceSpans)
      span.children = mergeTraceSpanChildren(span.children || [], flattenedChildren)
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

    const hasErrors = groupedRootSpans.some((span) => {
      if (span.status === 'error') return true
      const checkChildren = (children: TraceSpan[] = []): boolean => {
        return children.some(
          (child) => child.status === 'error' || (child.children && checkChildren(child.children))
        )
      }
      return span.children && checkChildren(span.children)
    })

    const workflowSpan: TraceSpan = {
      id: 'workflow-execution',
      name: 'Workflow Execution',
      type: 'workflow',
      duration: actualWorkflowDuration, // Always use actual duration for the span
      startTime: new Date(earliestStart).toISOString(),
      endTime: new Date(latestEnd).toISOString(),
      status: hasErrors ? 'error' : 'success',
      children: groupedRootSpans,
    }

    return { traceSpans: [workflowSpan], totalDuration: actualWorkflowDuration }
  }

  return { traceSpans: groupedRootSpans, totalDuration }
}

/**
 * Groups iteration-based blocks (parallel and loop) by organizing their iteration spans
 * into a hierarchical structure with proper parent-child relationships.
 *
 * @param spans - Array of root spans to process
 * @returns Array of spans with iteration blocks properly grouped
 */
function groupIterationBlocks(spans: TraceSpan[]): TraceSpan[] {
  const result: TraceSpan[] = []
  const iterationSpans: TraceSpan[] = []
  const normalSpans: TraceSpan[] = []

  spans.forEach((span) => {
    const iterationMatch = span.name.match(/^(.+) \(iteration (\d+)\)$/)
    if (iterationMatch) {
      iterationSpans.push(span)
    } else {
      normalSpans.push(span)
    }
  })

  const nonIterationContainerSpans = normalSpans.filter(
    (span) => span.type !== 'parallel' && span.type !== 'loop'
  )

  if (iterationSpans.length > 0) {
    const containerGroups = new Map<
      string,
      {
        type: 'parallel' | 'loop'
        containerId: string
        containerName: string
        spans: TraceSpan[]
      }
    >()

    // Track sequential numbers for loops and parallels
    const loopNumbers = new Map<string, number>()
    const parallelNumbers = new Map<string, number>()
    let loopCounter = 1
    let parallelCounter = 1

    iterationSpans.forEach((span) => {
      const iterationMatch = span.name.match(/^(.+) \(iteration (\d+)\)$/)
      if (iterationMatch) {
        let containerType: 'parallel' | 'loop' = 'loop'
        let containerId = 'unknown'
        let containerName = 'Unknown'

        // Use the loopId/parallelId from the span metadata (set during execution)
        if (span.parallelId) {
          containerType = 'parallel'
          containerId = span.parallelId

          const parallelBlock = normalSpans.find(
            (s) => s.blockId === containerId && s.type === 'parallel'
          )

          // Use custom name if available, otherwise assign sequential number
          if (parallelBlock?.name) {
            containerName = parallelBlock.name
          } else {
            if (!parallelNumbers.has(containerId)) {
              parallelNumbers.set(containerId, parallelCounter++)
            }
            containerName = `Parallel ${parallelNumbers.get(containerId)}`
          }
        } else if (span.loopId) {
          containerType = 'loop'
          containerId = span.loopId

          const loopBlock = normalSpans.find((s) => s.blockId === containerId && s.type === 'loop')

          // Use custom name if available, otherwise assign sequential number
          if (loopBlock?.name) {
            containerName = loopBlock.name
          } else {
            if (!loopNumbers.has(containerId)) {
              loopNumbers.set(containerId, loopCounter++)
            }
            containerName = `Loop ${loopNumbers.get(containerId)}`
          }
        } else {
          // Fallback to old logic if metadata is missing
          if (span.blockId?.includes('_parallel_')) {
            const parallelMatch = span.blockId.match(/_parallel_([^_]+)_iteration_/)
            if (parallelMatch) {
              containerType = 'parallel'
              containerId = parallelMatch[1]

              const parallelBlock = normalSpans.find(
                (s) => s.blockId === containerId && s.type === 'parallel'
              )

              // Use custom name if available, otherwise assign sequential number
              if (parallelBlock?.name) {
                containerName = parallelBlock.name
              } else {
                if (!parallelNumbers.has(containerId)) {
                  parallelNumbers.set(containerId, parallelCounter++)
                }
                containerName = `Parallel ${parallelNumbers.get(containerId)}`
              }
            }
          } else {
            containerType = 'loop'
            // Find the first loop as fallback
            const loopBlock = normalSpans.find((s) => s.type === 'loop')
            if (loopBlock?.blockId) {
              containerId = loopBlock.blockId

              // Use custom name if available, otherwise assign sequential number
              if (loopBlock.name) {
                containerName = loopBlock.name
              } else {
                if (!loopNumbers.has(containerId)) {
                  loopNumbers.set(containerId, loopCounter++)
                }
                containerName = `Loop ${loopNumbers.get(containerId)}`
              }
            } else {
              containerId = 'loop-1'
              containerName = 'Loop 1'
            }
          }
        }

        const groupKey = `${containerType}_${containerId}`

        if (!containerGroups.has(groupKey)) {
          containerGroups.set(groupKey, {
            type: containerType,
            containerId,
            containerName,
            spans: [],
          })
        }

        containerGroups.get(groupKey)!.spans.push(span)
      }
    })

    containerGroups.forEach((group, groupKey) => {
      const { type, containerId, containerName, spans } = group

      const iterationGroups = new Map<number, TraceSpan[]>()

      spans.forEach((span) => {
        const iterationMatch = span.name.match(/^(.+) \(iteration (\d+)\)$/)
        if (iterationMatch) {
          const iterationIndex = Number.parseInt(iterationMatch[2])

          if (!iterationGroups.has(iterationIndex)) {
            iterationGroups.set(iterationIndex, [])
          }
          iterationGroups.get(iterationIndex)!.push(span)
        }
      })

      if (type === 'parallel') {
        const allIterationSpans = spans

        const startTimes = allIterationSpans.map((span) => new Date(span.startTime).getTime())
        const endTimes = allIterationSpans.map((span) => new Date(span.endTime).getTime())
        const earliestStart = Math.min(...startTimes)
        const latestEnd = Math.max(...endTimes)
        const totalDuration = latestEnd - earliestStart

        const iterationChildren: TraceSpan[] = []

        const sortedIterations = Array.from(iterationGroups.entries()).sort(([a], [b]) => a - b)

        sortedIterations.forEach(([iterationIndex, spans]) => {
          const iterStartTimes = spans.map((span) => new Date(span.startTime).getTime())
          const iterEndTimes = spans.map((span) => new Date(span.endTime).getTime())
          const iterEarliestStart = Math.min(...iterStartTimes)
          const iterLatestEnd = Math.max(...iterEndTimes)
          const iterDuration = iterLatestEnd - iterEarliestStart

          const hasErrors = spans.some((span) => span.status === 'error')

          const iterationSpan: TraceSpan = {
            id: `${containerId}-iteration-${iterationIndex}`,
            name: `Iteration ${iterationIndex}`,
            type: 'parallel-iteration',
            duration: iterDuration,
            startTime: new Date(iterEarliestStart).toISOString(),
            endTime: new Date(iterLatestEnd).toISOString(),
            status: hasErrors ? 'error' : 'success',
            children: spans.map((span) => ({
              ...span,
              name: span.name.replace(/ \(iteration \d+\)$/, ''),
            })),
          }

          iterationChildren.push(iterationSpan)
        })

        const hasErrors = allIterationSpans.some((span) => span.status === 'error')
        const parallelContainer: TraceSpan = {
          id: `parallel-execution-${containerId}`,
          name: containerName,
          type: 'parallel',
          duration: totalDuration,
          startTime: new Date(earliestStart).toISOString(),
          endTime: new Date(latestEnd).toISOString(),
          status: hasErrors ? 'error' : 'success',
          children: iterationChildren,
        }

        result.push(parallelContainer)
      } else {
        const allIterationSpans = spans

        const startTimes = allIterationSpans.map((span) => new Date(span.startTime).getTime())
        const endTimes = allIterationSpans.map((span) => new Date(span.endTime).getTime())
        const earliestStart = Math.min(...startTimes)
        const latestEnd = Math.max(...endTimes)
        const totalDuration = latestEnd - earliestStart

        const iterationChildren: TraceSpan[] = []

        const sortedIterations = Array.from(iterationGroups.entries()).sort(([a], [b]) => a - b)

        sortedIterations.forEach(([iterationIndex, spans]) => {
          const iterStartTimes = spans.map((span) => new Date(span.startTime).getTime())
          const iterEndTimes = spans.map((span) => new Date(span.endTime).getTime())
          const iterEarliestStart = Math.min(...iterStartTimes)
          const iterLatestEnd = Math.max(...iterEndTimes)
          const iterDuration = iterLatestEnd - iterEarliestStart

          const hasErrors = spans.some((span) => span.status === 'error')

          const iterationSpan: TraceSpan = {
            id: `${containerId}-iteration-${iterationIndex}`,
            name: `Iteration ${iterationIndex}`,
            type: 'loop-iteration',
            duration: iterDuration,
            startTime: new Date(iterEarliestStart).toISOString(),
            endTime: new Date(iterLatestEnd).toISOString(),
            status: hasErrors ? 'error' : 'success',
            children: spans.map((span) => ({
              ...span,
              name: span.name.replace(/ \(iteration \d+\)$/, ''),
            })),
          }

          iterationChildren.push(iterationSpan)
        })

        const hasErrors = allIterationSpans.some((span) => span.status === 'error')
        const loopContainer: TraceSpan = {
          id: `loop-execution-${containerId}`,
          name: containerName,
          type: 'loop',
          duration: totalDuration,
          startTime: new Date(earliestStart).toISOString(),
          endTime: new Date(latestEnd).toISOString(),
          status: hasErrors ? 'error' : 'success',
          children: iterationChildren,
        }

        result.push(loopContainer)
      }
    })
  }

  result.push(...nonIterationContainerSpans)

  result.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

  return result
}

function ensureNestedWorkflowsProcessed(span: TraceSpan): TraceSpan {
  const processedSpan: TraceSpan = { ...span }

  if (processedSpan.output && typeof processedSpan.output === 'object') {
    processedSpan.output = { ...processedSpan.output }
  }

  const normalizedChildren = Array.isArray(span.children)
    ? span.children.map((child) => ensureNestedWorkflowsProcessed(child))
    : []

  const outputChildSpans = (() => {
    if (!processedSpan.output || typeof processedSpan.output !== 'object') {
      return [] as TraceSpan[]
    }

    const maybeChildSpans = (processedSpan.output as { childTraceSpans?: TraceSpan[] })
      .childTraceSpans
    if (!Array.isArray(maybeChildSpans) || maybeChildSpans.length === 0) {
      return [] as TraceSpan[]
    }

    return flattenWorkflowChildren(maybeChildSpans)
  })()

  const mergedChildren = mergeTraceSpanChildren(normalizedChildren, outputChildSpans)

  if (
    processedSpan.output &&
    typeof processedSpan.output === 'object' &&
    processedSpan.output !== null &&
    'childTraceSpans' in processedSpan.output
  ) {
    const { childTraceSpans, ...cleanOutput } = processedSpan.output as {
      childTraceSpans?: TraceSpan[]
    } & Record<string, unknown>
    processedSpan.output = cleanOutput
  }

  processedSpan.children = mergedChildren.length > 0 ? mergedChildren : undefined

  return processedSpan
}

export function stripCustomToolPrefix(name: string) {
  return name.startsWith('custom_') ? name.replace('custom_', '') : name
}
