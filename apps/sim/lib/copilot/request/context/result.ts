import { getToolCallStateOutput } from '@/lib/copilot/request/tool-call-state'
import type { StreamingContext, ToolCallSummary } from '@/lib/copilot/request/types'

/**
 * Build a ToolCallSummary array from the streaming context.
 */
export function buildToolCallSummaries(context: StreamingContext): ToolCallSummary[] {
  return Array.from(context.toolCalls.values()).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status,
    params: toolCall.params,
    result: getToolCallStateOutput(toolCall),
    error: toolCall.error,
    durationMs:
      toolCall.endTime && toolCall.startTime ? toolCall.endTime - toolCall.startTime : undefined,
  }))
}
