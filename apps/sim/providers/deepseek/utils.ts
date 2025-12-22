import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createOpenAICompatibleStream } from '@/providers/utils'

/**
 * Creates a ReadableStream from a DeepSeek streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromDeepseekStream(
  deepseekStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(deepseekStream, 'Deepseek', onComplete)
}
