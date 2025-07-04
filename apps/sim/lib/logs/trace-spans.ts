import type { TraceSpan } from '@/app/workspace/[workspaceId]/logs/stores/types'
import type { ExecutionResult } from '@/executor/types'

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
    }

    // Add provider timing data if it exists
    if (log.output?.providerTiming) {
      const providerTiming = log.output.providerTiming

      // If we have time segments, use them to create a more detailed timeline
      if (providerTiming.timeSegments && providerTiming.timeSegments.length > 0) {
        const segmentStartTime = new Date(log.startedAt).getTime()
        const children: TraceSpan[] = []

        // Process segments in order
        providerTiming.timeSegments.forEach(
          (
            segment: {
              type: string
              name: string
              startTime: number
              endTime: number
              duration: number
            },
            index: number
          ) => {
            // Ensure we have valid startTime and endTime
            let segmentStart: number
            let segmentEnd: number

            // Handle different time formats - some providers use ISO strings, some use timestamps
            if (typeof segment.startTime === 'string') {
              try {
                segmentStart = new Date(segment.startTime).getTime()
              } catch (_e) {
                segmentStart = segmentStartTime + index * 1000 // Fallback offset
              }
            } else {
              segmentStart = segment.startTime
            }

            if (typeof segment.endTime === 'string') {
              try {
                segmentEnd = new Date(segment.endTime).getTime()
              } catch (_e) {
                segmentEnd = segmentStart + (segment.duration || 1000) // Fallback duration
              }
            } else {
              segmentEnd = segment.endTime
            }

            // For streaming responses, make sure our timing is valid
            if (
              Number.isNaN(segmentStart) ||
              Number.isNaN(segmentEnd) ||
              segmentEnd < segmentStart
            ) {
              // Use fallback values
              segmentStart = segmentStartTime + index * 1000
              segmentEnd = segmentStart + (segment.duration || 1000)
            }

            const childSpan: TraceSpan = {
              id: `${spanId}-segment-${index}`,
              name: segment.name || `${segment.type} operation`,
              startTime: new Date(segmentStart).toISOString(),
              endTime: new Date(segmentEnd).toISOString(),
              duration: segment.duration || segmentEnd - segmentStart,
              type:
                segment.type === 'model'
                  ? 'model'
                  : segment.type === 'tool'
                    ? 'tool'
                    : 'processing',
              status: 'success',
              children: [],
            }

            // Add any additional metadata
            if (segment.type === 'tool' && typeof segment.name === 'string') {
              // Add as a custom attribute using type assertion
              ;(childSpan as any).toolName = segment.name
            }

            children.push(childSpan)
          }
        )

        // Only add children if we have valid spans
        if (children.length > 0) {
          span.children = children
        }
      }
      // If no segments but we have provider timing, create a provider span
      else {
        // Create a child span for the provider execution
        const providerSpan: TraceSpan = {
          id: `${spanId}-provider`,
          name: log.output.model || 'AI Provider',
          type: 'provider',
          duration: providerTiming.duration || 0,
          startTime: providerTiming.startTime || log.startedAt,
          endTime: providerTiming.endTime || log.endedAt,
          status: 'success',
          tokens: log.output.tokens?.total,
        }

        // If we have model time, create a child span for just the model processing
        if (providerTiming.modelTime) {
          const modelName = log.output.model || ''
          const modelSpan: TraceSpan = {
            id: `${spanId}-model`,
            name: `Model Generation${modelName ? ` (${modelName})` : ''}`,
            type: 'model',
            duration: providerTiming.modelTime,
            startTime: providerTiming.startTime, // Approximate
            endTime: providerTiming.endTime, // Approximate
            status: 'success',
            tokens: log.output.tokens?.completion,
          }

          if (!providerSpan.children) providerSpan.children = []
          providerSpan.children.push(modelSpan)
        }

        if (!span.children) span.children = []
        span.children.push(providerSpan)

        // When using provider timing without segments, still add tool calls if they exist
        if (log.output?.toolCalls?.list) {
          span.toolCalls = log.output.toolCalls.list.map((tc: any) => ({
            name: stripCustomToolPrefix(tc.name),
            duration: tc.duration || 0,
            startTime: tc.startTime || log.startedAt,
            endTime: tc.endTime || log.endedAt,
            status: tc.error ? 'error' : 'success',
            input: tc.arguments || tc.input,
            output: tc.result || tc.output,
            error: tc.error,
          }))
        }
      }
    } else {
      // When not using provider timing at all, add tool calls if they exist
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
          console.warn(`toolCallsList is not an array: ${typeof toolCallsList}`)
          toolCallsList = []
        }
      } catch (error) {
        console.error(`Error extracting toolCalls: ${error}`)
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
              console.error(`Error processing tool call: ${tcError}`)
              return null
            }
          })
          .filter(Boolean) // Remove any null entries from failed processing
      }
    }

    // Store in map
    spanMap.set(spanId, span)
  })

  // Second pass: Build the hierarchy based on direct relationships
  // We'll first need to sort logs chronologically for proper order
  const sortedLogs = [...result.logs].sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime()
    const bTime = new Date(b.startedAt).getTime()
    return aTime - bTime
  })

  // Map to track spans by block ID (for parent-child relationship identification)
  const blockToSpanMap = new Map<string, string>()

  // First, map block IDs to their span IDs
  sortedLogs.forEach((log) => {
    if (!log.blockId) return

    const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
    blockToSpanMap.set(log.blockId, spanId)
  })

  // Identify root spans and build relationships
  const rootSpans: TraceSpan[] = []

  // For sequential blocks, we need to determine if they are true parent-child
  // or just execution dependencies. True parent-child should be nested,
  // while sequential execution blocks should be at the same level.

  // Identify blocks at the top level (aka "layer 0")
  const topLevelBlocks = new Set<string>()

  // Create the array of parent values once before the loop
  const parentValues = Array.from(parentChildMap.values())

  workflowConnections.forEach((conn) => {
    // If the source is starter or doesn't exist in our connections as a target, it's top level
    if (conn.source === 'starter' || !parentValues.includes(conn.source)) {
      topLevelBlocks.add(conn.target)
    }
  })

  sortedLogs.forEach((log) => {
    if (!log.blockId) return

    const spanId = `${log.blockId}-${new Date(log.startedAt).getTime()}`
    const span = spanMap.get(spanId)
    if (!span) return

    // Check if this block has a direct parent in the workflow
    const parentBlockId = parentChildMap.get(log.blockId)

    // Top level blocks are those that:
    // 1. Have no parent (or parent is starter)
    // 2. Are identified as top level in our analysis
    const isTopLevel =
      !parentBlockId || parentBlockId === 'starter' || topLevelBlocks.has(log.blockId)

    if (isTopLevel) {
      // This is a top level span
      rootSpans.push(span)
    } else {
      // This has a parent
      // Only nest as a child if the parent block is NOT a top-level block
      // This ensures sequential blocks at the same "layer" stay at the same level
      // while true parent-child relationships are preserved
      if (parentBlockId && !topLevelBlocks.has(parentBlockId)) {
        const parentSpanId = blockToSpanMap.get(parentBlockId)

        if (parentSpanId) {
          const parentSpan = spanMap.get(parentSpanId)
          if (parentSpan) {
            // Add as child to direct parent
            if (!parentSpan.children) parentSpan.children = []
            parentSpan.children.push(span)
          } else {
            // Parent span not found, add as root
            rootSpans.push(span)
          }
        } else {
          // Parent block executed but no span, add as root
          rootSpans.push(span)
        }
      } else {
        // Parent is a top level block, so this should also be a top level span
        // This prevents sequential top-level blocks from being nested
        rootSpans.push(span)
      }
    }
  })

  // Fall back to time-based hierarchy only if we couldn't establish relationships
  // This happens when we don't have workflow connection information
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
