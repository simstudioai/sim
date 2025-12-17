import { createLogger } from '@/lib/logs/console/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('OpenRouterProvider')

/**
 * Creates a ReadableStream from an OpenAI-compatible stream response
 * @param openaiStream - The OpenAI stream to convert
 * @param onComplete - Optional callback when streaming is complete with content and usage data
 * @returns ReadableStream that emits text chunks
 */
export function createReadableStreamFromOpenAIStream(
  openaiStream: any,
  onComplete?: (content: string, usage?: any) => void
): ReadableStream {
  let fullContent = ''
  let usageData: any = null

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of openaiStream) {
          if (chunk.usage) {
            usageData = chunk.usage
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          onComplete(fullContent, usageData)
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
