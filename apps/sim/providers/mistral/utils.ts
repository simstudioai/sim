import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleStream } from '@/providers/utils'

/**
 * Creates a ReadableStream from a Mistral streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromMistralStream(
  mistralStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(mistralStream, 'Mistral', onComplete)
}
