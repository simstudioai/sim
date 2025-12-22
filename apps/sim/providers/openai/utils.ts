import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { Stream } from 'openai/streaming'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OpenAIUtils')

export function createReadableStreamFromOpenAIStream(
  openaiStream: Stream<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let chunkCount = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of openaiStream) {
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0
            completionTokens = chunk.usage.completion_tokens ?? 0
            totalTokens = chunk.usage.total_tokens ?? 0
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            chunkCount++
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            logger.warn('OpenAI stream completed without usage data')
          }
          onComplete(fullContent, {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens || promptTokens + completionTokens,
          })
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
