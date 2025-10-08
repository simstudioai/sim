import { createLogger } from '@/lib/logs/console/logger'
import type { TraceSpan } from '@/lib/logs/types'
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

// Helper function to build a tree of trace spans from execution logs
export function buildTraceSpans(result: ExecutionResult): {
  traceSpans: TraceSpan[]
  totalDuration: number
} {
  // If no logs, return empty spans
  if (!result.logs || result.logs.length === 0) {
    return { traceSpans: [], totalDuration: 0 }
  }

  // Store all spans as a map for faster lookup
  const spanMap = new Map<string, TraceSpan>()

  // Create a map to track parent-child relationships from workflow structure
  // This helps distinguish between actual parent-child relationships vs parallel execution
  const parentChildMap = new Map<string, string>()

  // If we have workflow information in the logs, extract parent-child relationships
  // Define connection type inline for now
  type Connection = { source: string; target: string }
  const workflowConnections: Connection[] = result.metadata?.workflowConnections || []
  if (workflowConnections.length > 0) {
    // Build the connection map from workflow connections
    workflowConnections.forEach((conn: Connection) => {
      if (conn.source && conn.target) {
        parentChildMap.set(conn.target, conn.source)
      }
    })
  }

  // First pass: Create spans for each block
  result.logs.forEach((log) => {
    // Skip logs that don't have block execution information
    if (!log.blockId || !log.blockType) return

    // Create a unique ID for this span using blockId and timestamp
    const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`

    // Extract duration if available
    const duration = log.durationMs || 0

    // Create the span
    let output = log.output || {}

    // If there's an error, include it in the output
    if (log.error) {
      output = {
        ...output,
        error: log.error,
      }
    }

    // Use block name consistently for all block types
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
      // Store the block ID for later use in identifying direct parent-child relationships
      blockId: log.blockId,
      // Include block input/output data
      input: log.input || {},
      output: output,
    }

    // Add provider timing data if it exists
    if (log.output?.providerTiming) {
      const providerTiming = log.output.providerTiming

      // Store provider timing as metadata instead of creating child spans
      // This keeps the UI cleaner while preserving timing information

      ;(span as any).providerTiming = {
        duration: providerTiming.duration,
        startTime: providerTiming.startTime,
        endTime: providerTiming.endTime,
        segments: providerTiming.timeSegments || [],
      }
    }

    // Always add cost, token, and model information if available (regardless of provider timing)
    if (log.output?.cost) {
      ;(span as any).cost = log.output.cost
    }

    if (log.output?.tokens) {
      ;(span as any).tokens = log.output.tokens
    }

    if (log.output?.model) {
      ;(span as any).model = log.output.model
    }

    // Enhanced approach: Use timeSegments for sequential flow if available
    // This provides the actual model→tool→model execution sequence
    // Skip for workflow blocks since they will be processed via output.childTraceSpans at the end
    if (
      !isWorkflowBlockType(log.blockType) &&
      log.output?.providerTiming?.timeSegments &&
      Array.isArray(log.output.providerTiming.timeSegments)
    ) {
      const timeSegments = log.output.providerTiming.timeSegments
      const toolCallsData = log.output?.toolCalls?.list || log.output?.toolCalls || []

      // Create child spans for each time segment
      span.children = timeSegments.map((segment: any, index: number) => {
        const segmentStartTime = new Date(segment.startTime).toISOString()
        const segmentEndTime = new Date(segment.endTime).toISOString()

        if (segment.type === 'tool') {
          // Find matching tool call data for this segment
          const matchingToolCall = toolCallsData.find(
            (tc: any) => tc.name === segment.name || stripCustomToolPrefix(tc.name) === segment.name
          )

          return {
            id: `${span.id}-segment-${index}`,
            name: stripCustomToolPrefix(segment.name),
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
        // Model segment
        return {
          id: `${span.id}-segment-${index}`,
          name: segment.name,
          type: 'model',
          duration: segment.duration,
          startTime: segmentStartTime,
          endTime: segmentEndTime,
          status: 'success',
        }
      })
    } else {
      // Fallback: Extract tool calls using the original approach for backwards compatibility
      // Tool calls handling for different formats:
      // 1. Standard format in response.toolCalls.list
      // 2. Direct toolCalls array in response
      // 3. Streaming response formats with executionData

      // Check all possible paths for toolCalls
      let toolCallsList = null

      // Wrap extraction in try-catch to handle unexpected toolCalls formats
      try {
        if (log.output?.toolCalls?.list) {
          // Standard format with list property
          toolCallsList = log.output.toolCalls.list
        } else if (Array.isArray(log.output?.toolCalls)) {
          // Direct array format
          toolCallsList = log.output.toolCalls
        } else if (log.output?.executionData?.output?.toolCalls) {
          // Streaming format with executionData
          const tcObj = log.output.executionData.output.toolCalls
          toolCallsList = Array.isArray(tcObj) ? tcObj : tcObj.list || []
        }

        // Validate that toolCallsList is actually an array before processing
        if (toolCallsList && !Array.isArray(toolCallsList)) {
          logger.warn(`toolCallsList is not an array: ${typeof toolCallsList}`, {
            blockId: log.blockId,
            blockType: log.blockType,
          })
          toolCallsList = []
        }
      } catch (error) {
        logger.error(`Error extracting toolCalls from block ${log.blockId}:`, error)
        toolCallsList = [] // Set to empty array as fallback
      }

      if (toolCallsList && toolCallsList.length > 0) {
        span.toolCalls = toolCallsList
          .map((tc: any) => {
            // Add null check for each tool call
            if (!tc) return null

            try {
              return {
                name: stripCustomToolPrefix(tc.name || 'unnamed-tool'),
                duration: tc.duration || 0,
                startTime: tc.startTime || log.startedAt,
                endTime: tc.endTime || log.endedAt,
                status: tc.error ? 'error' : 'success',
                input: tc.arguments || tc.input,
                output: tc.result || tc.output,
                error: tc.error,
              }
            } catch (tcError) {
              logger.error(`Error processing tool call in block ${log.blockId}:`, tcError)
              return null
            }
          })
          .filter(Boolean) // Remove any null entries from failed processing
      }
    }

    // Handle child workflow spans for workflow blocks - process at the end to avoid being overwritten
    if (
      isWorkflowBlockType(log.blockType) &&
      log.output?.childTraceSpans &&
      Array.isArray(log.output.childTraceSpans)
    ) {
      const childTraceSpans = log.output.childTraceSpans as TraceSpan[]
      const flattenedChildren = flattenWorkflowChildren(childTraceSpans)
      span.children = mergeTraceSpanChildren(span.children || [], flattenedChildren)
    }

    // Store in map
    spanMap.set(spanId, span)
  })

  // Second pass: Build a flat hierarchy for sequential workflow execution
  // For most workflows, blocks execute sequentially and should be shown at the same level
  // Only nest blocks that are truly hierarchical (like subflows, loops, etc.)

  const sortedLogs = [...result.logs].sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime()
    const bTime = new Date(b.startedAt).getTime()
    return aTime - bTime
  })

  const rootSpans: TraceSpan[] = []

  // For now, treat all blocks as top-level spans in execution order
  // This gives a cleaner, more intuitive view of workflow execution
  sortedLogs.forEach((log) => {
    if (!log.blockId) return

    const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
    const span = spanMap.get(spanId)
    if (span) {
      rootSpans.push(span)
    }
  })

  if (rootSpans.length === 0 && workflowConnections.length === 0) {
    // Track parent spans using a stack
    const spanStack: TraceSpan[] = []

    // Process logs to build time-based hierarchy (original approach)
    sortedLogs.forEach((log) => {
      if (!log.blockId || !log.blockType) return

      const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
      const span = spanMap.get(spanId)
      if (!span) return

      // If we have a non-empty stack, check if this span should be a child
      if (spanStack.length > 0) {
        const potentialParent = spanStack[spanStack.length - 1]
        const parentStartTime = new Date(potentialParent.startTime).getTime()
        const parentEndTime = new Date(potentialParent.endTime).getTime()
        const spanStartTime = new Date(span.startTime).getTime()

        // If this span starts after the parent starts and the parent is still on the stack,
        // we'll assume it's a child span
        if (spanStartTime >= parentStartTime && spanStartTime <= parentEndTime) {
          if (!potentialParent.children) potentialParent.children = []
          potentialParent.children.push(span)
        } else {
          // This span doesn't belong to the current parent, pop from stack
          while (
            spanStack.length > 0 &&
            new Date(spanStack[spanStack.length - 1].endTime).getTime() < spanStartTime
          ) {
            spanStack.pop()
          }

          // Check if we still have a parent
          if (spanStack.length > 0) {
            const newParent = spanStack[spanStack.length - 1]
            if (!newParent.children) newParent.children = []
            newParent.children.push(span)
          } else {
            // No parent, this is a root span
            rootSpans.push(span)
          }
        }
      } else {
        // Empty stack, this is a root span
        rootSpans.push(span)
      }

      // Check if this span could be a parent to future spans
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

    iterationSpans.forEach((span) => {
      const iterationMatch = span.name.match(/^(.+) \(iteration (\d+)\)$/)
      if (iterationMatch) {
        let containerType: 'parallel' | 'loop' = 'loop'
        let containerId = 'unknown'
        let containerName = 'Unknown'

        if (span.blockId?.includes('_parallel_')) {
          const parallelMatch = span.blockId.match(/_parallel_([^_]+)_iteration_/)
          if (parallelMatch) {
            containerType = 'parallel'
            containerId = parallelMatch[1]

            const parallelBlock = normalSpans.find(
              (s) => s.blockId === containerId && s.type === 'parallel'
            )
            containerName = parallelBlock?.name || `Parallel ${containerId}`
          }
        } else {
          containerType = 'loop'

          const loopBlock = normalSpans.find((s) => s.type === 'loop')
          if (loopBlock) {
            containerId = loopBlock.blockId || 'loop-1'
            containerName = loopBlock.name || `Loop ${loopBlock.blockId || '1'}`
          } else {
            containerId = 'loop-1'
            containerName = 'Loop 1'
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

  if (processedSpan.output && 'childTraceSpans' in processedSpan.output) {
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
