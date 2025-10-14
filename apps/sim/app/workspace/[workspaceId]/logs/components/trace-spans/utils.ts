import { redactApiKeys } from '@/lib/utils'
import type { TraceSpan } from '@/stores/logs/filters/types'

export function getSpanKey(span: TraceSpan): string {
  if (span.id) {
    return span.id
  }

  const name = span.name || 'span'
  const start = span.startTime || 'unknown-start'
  const end = span.endTime || 'unknown-end'

  return `${name}|${start}|${end}`
}

export function mergeTraceSpanChildren(...groups: TraceSpan[][]): TraceSpan[] {
  const merged: TraceSpan[] = []
  const seen = new Set<string>()

  groups.forEach((group) => {
    group.forEach((child) => {
      const key = getSpanKey(child)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push(child)
    })
  })

  return merged
}

export function normalizeChildWorkflowSpan(span: TraceSpan): TraceSpan {
  const enrichedSpan: TraceSpan = { ...span }

  if (enrichedSpan.output && typeof enrichedSpan.output === 'object') {
    enrichedSpan.output = { ...enrichedSpan.output }
  }

  const normalizedChildren = Array.isArray(span.children)
    ? span.children.map((childSpan) => normalizeChildWorkflowSpan(childSpan))
    : []

  const outputChildSpans = Array.isArray(span.output?.childTraceSpans)
    ? (span.output!.childTraceSpans as TraceSpan[]).map((childSpan) =>
        normalizeChildWorkflowSpan(childSpan)
      )
    : []

  const mergedChildren = mergeTraceSpanChildren(normalizedChildren, outputChildSpans)

  if (enrichedSpan.output && 'childTraceSpans' in enrichedSpan.output) {
    const { childTraceSpans, ...cleanOutput } = enrichedSpan.output as {
      childTraceSpans?: TraceSpan[]
    } & Record<string, unknown>
    enrichedSpan.output = cleanOutput
  }

  enrichedSpan.children = mergedChildren.length > 0 ? mergedChildren : undefined

  return enrichedSpan
}

// Transform raw block data into clean, user-friendly format
export function transformBlockData(data: any, blockType: string, isInput: boolean) {
  if (!data) return null

  // For input data, filter out sensitive information
  if (isInput) {
    const cleanInput = redactApiKeys(data)

    // Remove null/undefined values for cleaner display
    Object.keys(cleanInput).forEach((key) => {
      if (cleanInput[key] === null || cleanInput[key] === undefined) {
        delete cleanInput[key]
      }
    })

    return cleanInput
  }

  // For output data, extract meaningful information based on block type
  if (data.response) {
    const response = data.response

    switch (blockType) {
      case 'agent':
        return {
          content: response.content,
          model: data.model,
          tokens: data.tokens,
          toolCalls: response.toolCalls,
          ...(data.cost && { cost: data.cost }),
        }

      case 'function':
        return {
          result: response.result,
          stdout: response.stdout,
          ...(response.executionTime && { executionTime: `${response.executionTime}ms` }),
        }

      case 'api':
        return {
          data: response.data,
          status: response.status,
          headers: response.headers,
        }

      case 'tool':
        // For tool calls, show the result data directly
        return response

      default:
        // For other block types, show the response content
        return response
    }
  }

  return data
}

export function formatDurationDisplay(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}
