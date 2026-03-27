import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamingContext, ToolCallSummary } from '@/lib/copilot/request/types'

/**
 * Build a ToolCallSummary array from the streaming context.
 */
export function buildToolCallSummaries(context: StreamingContext): ToolCallSummary[] {
  return Array.from(context.toolCalls.values()).map((toolCall) => {
    let status = toolCall.status
    if (toolCall.result && toolCall.result.success !== undefined) {
      status = toolCall.result.success
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error
    } else if ((status === 'pending' || status === 'executing') && toolCall.error) {
      status = MothershipStreamV1ToolOutcome.error
    }

    return {
      id: toolCall.id,
      name: toolCall.name,
      status,
      params: toolCall.params,
      result: toolCall.result?.output,
      error: toolCall.error,
      durationMs:
        toolCall.endTime && toolCall.startTime ? toolCall.endTime - toolCall.startTime : undefined,
    }
  })
}
