import { createLogger } from '@/lib/logs/console-logger'
import type { TraceSpan } from '@/lib/logs/types'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('TraceSpans')

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

    const span: TraceSpan = {
      id: spanId,
      name: log.blockName || log.blockId,
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
      logger.debug(`Added cost to span ${span.id}`, {
        blockId: log.blockId,
        blockType: log.blockType,
        cost: log.output.cost,
      })
    }

    if (log.output?.tokens) {
      ;(span as any).tokens = log.output.tokens
      logger.debug(`Added tokens to span ${span.id}`, {
        blockId: log.blockId,
        blockType: log.blockType,
        tokens: log.output.tokens,
      })
    }

    if (log.output?.model) {
      ;(span as any).model = log.output.model
      logger.debug(`Added model to span ${span.id}`, {
        blockId: log.blockId,
        blockType: log.blockType,
        model: log.output.model,
      })
    }

    // Enhanced approach: Use timeSegments for sequential flow if available
    // This provides the actual model→tool→model execution sequence
    if (
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

      logger.debug(
        `Created ${span.children?.length || 0} sequential segments for span ${span.id}`,
        {
          blockId: log.blockId,
          blockType: log.blockType,
          segments:
            span.children?.map((child) => ({
              name: child.name,
              type: child.type,
              duration: child.duration,
            })) || [],
        }
      )
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

        logger.debug(`Added ${span.toolCalls?.length || 0} tool calls to span ${span.id}`, {
          blockId: log.blockId,
          blockType: log.blockType,
          toolCallNames: span.toolCalls?.map((tc) => tc.name) || [],
        })
      }
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
      if (log.blockType === 'agent' || log.blockType === 'workflow') {
        spanStack.push(span)
      }
    })
  }

  // Calculate total duration as the sum of root spans
  const totalDuration = rootSpans.reduce((sum, span) => sum + span.duration, 0)

  // Create a synthetic workflow span that represents the entire execution
  // This ensures we have a consistent top-level representation
  if (rootSpans.length > 0 && result.metadata) {
    // Get all spans to calculate accurate timings
    const allSpansList = Array.from(spanMap.values())

    // Find the earliest start time and latest end time across all spans
    const earliestStart = allSpansList.reduce((earliest, span) => {
      const startTime = new Date(span.startTime).getTime()
      return startTime < earliest ? startTime : earliest
    }, Number.POSITIVE_INFINITY)

    const latestEnd = allSpansList.reduce((latest, span) => {
      const endTime = new Date(span.endTime).getTime()
      return endTime > latest ? endTime : latest
    }, 0)

    // Calculate actual workflow duration from earliest start to latest end
    // This correctly accounts for parallel execution
    const actualWorkflowDuration = latestEnd - earliestStart

    // Check if any spans have errors to determine overall workflow status
    const hasErrors = rootSpans.some((span) => {
      if (span.status === 'error') return true
      // Recursively check children for errors
      const checkChildren = (children: TraceSpan[] = []): boolean => {
        return children.some(
          (child) => child.status === 'error' || (child.children && checkChildren(child.children))
        )
      }
      return span.children && checkChildren(span.children)
    })

    // Create the workflow span
    const workflowSpan: TraceSpan = {
      id: 'workflow-execution',
      name: 'Workflow Execution',
      type: 'workflow',
      duration: actualWorkflowDuration, // Always use actual duration for the span
      startTime: new Date(earliestStart).toISOString(),
      endTime: new Date(latestEnd).toISOString(),
      status: hasErrors ? 'error' : 'success',
      children: rootSpans,
    }

    // Return this as the only root span, using the actual duration for total
    return { traceSpans: [workflowSpan], totalDuration: actualWorkflowDuration }
  }

  return { traceSpans: rootSpans, totalDuration }
}

export function stripCustomToolPrefix(name: string) {
  return name.startsWith('custom_') ? name.replace('custom_', '') : name
}
