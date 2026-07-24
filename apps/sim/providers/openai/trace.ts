import type OpenAI from 'openai'
import type { IterationToolCall } from '@/executor/types'
import {
  extractResponseReasoning,
  parseResponsesUsage,
  type ResponsesToolCall,
} from '@/providers/openai/utils'
import { enrichLastModelSegment, parseToolCallArguments } from '@/providers/trace-enrichment'
import type { TimeSegment } from '@/providers/types'
import { calculateCost } from '@/providers/utils'

/**
 * Maps a Responses API terminal response to Sim's conventional finish reason.
 */
function deriveOpenAIFinishReason(
  response: OpenAI.Responses.Response,
  toolCalls: ResponsesToolCall[]
): string | undefined {
  const incompleteReason = response.incomplete_details?.reason
  if (incompleteReason === 'max_output_tokens') return 'length'
  if (incompleteReason === 'content_filter') return 'content_filter'
  if (toolCalls.length > 0) return 'tool_calls'
  if (incompleteReason) return incompleteReason
  if (response.status === 'failed') return 'error'
  if (response.status === 'incomplete') return 'length'
  if (response.status && response.status !== 'completed') return response.status
  return 'stop'
}

/**
 * Enriches the latest model segment from a terminal Responses API response.
 */
export function enrichLastModelSegmentFromOpenAIResponse(
  timeSegments: TimeSegment[],
  response: OpenAI.Responses.Response,
  assistantText: string,
  toolCallsInResponse: ResponsesToolCall[],
  extras?: {
    model?: string
    ttft?: number
    errorType?: string
    errorMessage?: string
  }
): void {
  const toolCalls: IterationToolCall[] = toolCallsInResponse.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    arguments: parseToolCallArguments(toolCall.arguments),
  }))

  const usage = parseResponsesUsage(response.usage)
  const thinkingContent = extractResponseReasoning(response.output)

  let cost: { input: number; output: number; total: number } | undefined
  if (extras?.model && usage) {
    const full = calculateCost(
      extras.model,
      usage.promptTokens,
      usage.completionTokens,
      usage.cachedTokens > 0
    )
    cost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent: assistantText || undefined,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: deriveOpenAIFinishReason(response, toolCallsInResponse),
    tokens: usage
      ? {
          input: usage.promptTokens,
          output: usage.completionTokens,
          total: usage.totalTokens,
          ...(usage.cachedTokens > 0 && { cacheRead: usage.cachedTokens }),
          ...(usage.reasoningTokens > 0 && { reasoning: usage.reasoningTokens }),
        }
      : undefined,
    cost,
    provider: 'openai',
    ttft: extras?.ttft,
    errorType: extras?.errorType,
    errorMessage: extras?.errorMessage,
  })
}
