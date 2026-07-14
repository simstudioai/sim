import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'

/**
 * Creates an agent-events stream from a LiteLLM streaming response.
 * Uses the shared OpenAI-compatible agent event streaming utility.
 */
export function createReadableStreamFromLiteLLMStream(
  litellmStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage, thinking?: string) => void
): ReadableStream<AgentStreamEvent> {
  return createOpenAICompatibleAgentEventStream(litellmStream, {
    providerName: 'LiteLLM',
    onComplete: onComplete
      ? (result) => onComplete(result.content, result.usage, result.thinking)
      : undefined,
  })
}
