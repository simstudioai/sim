import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { checkForForcedToolUsageOpenAI } from '@/providers/utils'
import { normalizeXAIServiceTier, type XAIServiceTier } from '@/providers/xai/usage'

export type { XAIServiceTier } from '@/providers/xai/usage'

/**
 * Creates an agent-events stream from an xAI streaming response.
 * Uses the shared OpenAI-compatible agent event streaming utility.
 */
export function createReadableStreamFromXAIStream(
  xaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (
    content: string,
    usage: CompletionUsage,
    thinking?: string,
    serviceTier?: XAIServiceTier
  ) => void
): ReadableStream<AgentStreamEvent> {
  return createOpenAICompatibleAgentEventStream(xaiStream, {
    providerName: 'xAI',
    onComplete: onComplete
      ? (result) =>
          onComplete(
            result.content,
            result.usage,
            result.thinking,
            normalizeXAIServiceTier(result.serviceTier)
          )
      : undefined,
  })
}

/**
 * Creates a response format payload for xAI requests with JSON schema.
 */
export function createResponseFormatPayload(
  basePayload: any,
  allMessages: any[],
  responseFormat: any,
  currentMessages?: any[]
) {
  const payload = {
    ...basePayload,
    messages: currentMessages || allMessages,
  }

  if (responseFormat) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: responseFormat.name || 'structured_response',
        schema: responseFormat.schema || responseFormat,
        strict: responseFormat.strict !== false,
      },
    }
  }

  return payload
}

/**
 * Checks if a forced tool was used in an xAI response.
 * Uses the shared OpenAI-compatible forced tool usage helper.
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  return checkForForcedToolUsageOpenAI(response, toolChoice, 'xAI', forcedTools, usedForcedTools)
}
