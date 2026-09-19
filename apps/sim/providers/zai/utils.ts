import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderRequest } from '@/providers/types'

/**
 * Creates an agent-events stream from a Z.ai streaming response.
 * Uses the shared OpenAI-compatible agent event streaming utility.
 */
export function createReadableStreamFromZaiStream(
  zaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage, thinking?: string) => void,
  request?: ProviderRequest
): ReadableStream<AgentStreamEvent> {
  return createOpenAICompatibleAgentEventStream(zaiStream, {
    request,
    providerName: 'Z.ai',
    onComplete: onComplete
      ? (result) => onComplete(result.content, result.usage, result.thinking)
      : undefined,
  })
}
