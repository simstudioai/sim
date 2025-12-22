import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { Stream } from 'openai/streaming'
import { createOpenAICompatibleStream } from '@/providers/utils'

/**
 * Creates a ReadableStream from an OpenAI streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromOpenAIStream(
  openaiStream: Stream<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(openaiStream, 'OpenAI', onComplete)
}
