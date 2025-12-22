import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleStream } from '@/providers/utils'

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
 * Creates a ReadableStream from a Cerebras streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromCerebrasStream(
  cerebrasStream: AsyncIterable<CerebrasChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(cerebrasStream as any, 'Cerebras', onComplete)
}
