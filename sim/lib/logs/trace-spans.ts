import { TraceSpan } from '@/app/w/logs/stores/types'
import { ExecutionResult } from '@/executor/types'

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
    }

    // Add provider timing data if it exists
    if (log.output?.response?.providerTiming) {
      const providerTiming = log.output.response.providerTiming

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
            const relativeStart = segment.startTime - segmentStartTime

            // Enhance the segment name to include model information for model segments
            let enhancedName = segment.name
            if (segment.type === 'model') {
              const modelName = log.output.response.model || ''

              if (segment.name === 'Initial response') {
                enhancedName = `Initial response${modelName ? ` (${modelName})` : ''}`
              } else if (segment.name.includes('iteration')) {
                // Extract the iteration number
                const iterationMatch = segment.name.match(/\(iteration (\d+)\)/)
                const iterationNum = iterationMatch ? iterationMatch[1] : ''

                enhancedName = `Model response${iterationNum ? ` (iteration ${iterationNum})` : ''}${modelName ? ` (${modelName})` : ''}`
              }
            }

            const segmentSpan: TraceSpan = {
              id: `${spanId}-segment-${index}`,
              name: enhancedName,
              // Make sure we handle model and tool types, and fallback to generic 'span' for anything else
              type: segment.type === 'model' || segment.type === 'tool' ? segment.type : 'span',
              duration: segment.duration,
              startTime: new Date(segment.startTime).toISOString(),
              endTime: new Date(segment.endTime).toISOString(),
              status: 'success',
              // Add relative timing display for segments after the first one
              relativeStartMs: index === 0 ? undefined : relativeStart,
              // For model segments, add token info if available
              ...(segment.type === 'model' && {
                tokens: index === 0 ? log.output.response.tokens?.completion : undefined,
              }),
            }

            children.push(segmentSpan)
          }
        )

        // Add all segments as children
        if (!span.children) span.children = []
        span.children.push(...children)
      }
      // If no segments but we have provider timing, create a provider span
      else {
        // Create a child span for the provider execution
        const providerSpan: TraceSpan = {
          id: `${spanId}-provider`,
          name: log.output.response.model || 'AI Provider',
          type: 'provider',
          duration: providerTiming.duration || 0,
          startTime: providerTiming.startTime || log.startedAt,
          endTime: providerTiming.endTime || log.endedAt,
          status: 'success',
          tokens: log.output.response.tokens?.total,
        }

        // If we have model time, create a child span for just the model processing
        if (providerTiming.modelTime) {
          const modelName = log.output.response.model || ''
          const modelSpan: TraceSpan = {
            id: `${spanId}-model`,
            name: `Model Generation${modelName ? ` (${modelName})` : ''}`,
            type: 'model',
            duration: providerTiming.modelTime,
            startTime: providerTiming.startTime, // Approximate
            endTime: providerTiming.endTime, // Approximate
            status: 'success',
            tokens: log.output.response.tokens?.completion,
          }

          if (!providerSpan.children) providerSpan.children = []
          providerSpan.children.push(modelSpan)
        }

        if (!span.children) span.children = []
        span.children.push(providerSpan)

        // When using provider timing without segments, still add tool calls if they exist
        if (log.output?.response?.toolCalls?.list) {
          span.toolCalls = log.output.response.toolCalls.list.map((tc: any) => ({
            name: tc.name,
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
      if (log.output?.response?.toolCalls?.list) {
        span.toolCalls = log.output.response.toolCalls.list.map((tc: any) => ({
          name: tc.name,
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

    // Store in map
    spanMap.set(spanId, span)
  })

  // Second pass: Build the hierarchy
  // We'll first need to sort logs chronologically
  const sortedLogs = [...result.logs].sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime()
    const bTime = new Date(b.startedAt).getTime()
    return aTime - bTime
  })

  // Track parent spans using a stack
  const spanStack: TraceSpan[] = []
  const rootSpans: TraceSpan[] = []

  // Process logs to build the hierarchy
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

  // Calculate total duration as the sum of root spans
  const totalDuration = rootSpans.reduce((sum, span) => sum + span.duration, 0)

  return { traceSpans: rootSpans, totalDuration }
}
