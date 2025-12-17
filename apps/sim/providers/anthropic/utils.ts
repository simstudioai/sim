import { createLogger } from '@/lib/logs/console/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AnthropicUtils')

/**
 * Helper to wrap Anthropic streaming into a browser-friendly ReadableStream
 */
export function createReadableStreamFromAnthropicStream(
  anthropicStream: AsyncIterable<any>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta?.text) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

/**
 * Helper function to generate a simple unique ID for tool uses
 */
export function generateToolUseId(toolName: string): string {
  return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
}

/**
 * Helper function to check for forced tool usage in Anthropic responses
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: any,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } | null {
  if (typeof toolChoice === 'object' && toolChoice !== null && Array.isArray(response.content)) {
    const toolUses = response.content.filter((item: any) => item.type === 'tool_use')

    if (toolUses.length > 0) {
      // Convert Anthropic tool_use format to a format trackForcedToolUsage can understand
      const adaptedToolCalls = toolUses.map((tool: any) => ({
        name: tool.name,
      }))

      // Convert Anthropic tool_choice format to match OpenAI format for tracking
      const adaptedToolChoice =
        toolChoice.type === 'tool' ? { function: { name: toolChoice.name } } : toolChoice

      const result = trackForcedToolUsage(
        adaptedToolCalls,
        adaptedToolChoice,
        logger,
        'anthropic',
        forcedTools,
        usedForcedTools
      )

      return result
    }
  }
  return null
}
