import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { Stream } from 'openai/streaming'
import { createLogger, type Logger } from '@/lib/logs/console/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AzureOpenAIUtils')

export function createReadableStreamFromAzureOpenAIStream(
  azureOpenAIStream: Stream<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream {
  let fullContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of azureOpenAIStream) {
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0
            completionTokens = chunk.usage.completion_tokens ?? 0
            totalTokens = chunk.usage.total_tokens ?? 0
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            logger.warn('Azure OpenAI stream completed without usage data')
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

/**
 * Helper function to check for forced tool usage in responses
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  logger: Logger,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  let hasUsedForcedTool = false
  let updatedUsedForcedTools = [...usedForcedTools]

  if (typeof toolChoice === 'object' && response.choices[0]?.message?.tool_calls) {
    const toolCallsResponse = response.choices[0].message.tool_calls
    const result = trackForcedToolUsage(
      toolCallsResponse,
      toolChoice,
      logger,
      'azure-openai',
      forcedTools,
      updatedUsedForcedTools
    )
    hasUsedForcedTool = result.hasUsedForcedTool
    updatedUsedForcedTools = result.usedForcedTools
  }

  return { hasUsedForcedTool, usedForcedTools: updatedUsedForcedTools }
}
