import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderRequest } from '@/providers/types'

/**
 * Creates an agent-events stream from a Meta Model API streaming response.
 * Uses the shared OpenAI-compatible agent event streaming utility.
 */
export function createReadableStreamFromMetaStream(
  metaStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage, thinking?: string) => void,
  request?: ProviderRequest
): ReadableStream<AgentStreamEvent> {
  return createOpenAICompatibleAgentEventStream(metaStream, {
    request,
    providerName: 'Meta',
    onComplete: onComplete
      ? (result) => onComplete(result.content, result.usage, result.thinking)
      : undefined,
  })
}
