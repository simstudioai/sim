import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createLogger } from '@/lib/logs/console/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('OpenRouterUtils')

export function createReadableStreamFromOpenAIStream(
  openaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

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
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            logger.warn('OpenRouter stream completed without usage data')
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
 * Checks if a forced tool was used in the response and updates tracking
 * @param response - The API response containing tool calls
 * @param toolChoice - The tool choice configuration (string or object)
 * @param forcedTools - Array of forced tool names
 * @param usedForcedTools - Array of already used forced tools
 * @returns Object with hasUsedForcedTool flag and updated usedForcedTools array
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  let hasUsedForcedTool = false
  let updatedUsedForcedTools = usedForcedTools

  if (typeof toolChoice === 'object' && response.choices[0]?.message?.tool_calls) {
    const toolCallsResponse = response.choices[0].message.tool_calls
    const result = trackForcedToolUsage(
      toolCallsResponse,
      toolChoice,
      logger,
      'openrouter',
      forcedTools,
      updatedUsedForcedTools
    )
    hasUsedForcedTool = result.hasUsedForcedTool
    updatedUsedForcedTools = result.usedForcedTools
  }

  return { hasUsedForcedTool, usedForcedTools: updatedUsedForcedTools }
}
