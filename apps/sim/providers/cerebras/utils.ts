import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'

interface CerebrasChunk {
  choices?: Array<{
    delta?: {
      content?: string
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Creates an agent-events stream from a Cerebras streaming response.
 * Uses the shared OpenAI-compatible agent event streaming utility.
 */
export function createReadableStreamFromCerebrasStream(
  cerebrasStream: AsyncIterable<CerebrasChunk>,
  onComplete?: (content: string, usage: CompletionUsage, thinking?: string) => void
): ReadableStream<AgentStreamEvent> {
  return createOpenAICompatibleAgentEventStream(cerebrasStream as any, {
    providerName: 'Cerebras',
    onComplete: onComplete
      ? (result) => onComplete(result.content, result.usage, result.thinking)
      : undefined,
  })
}
