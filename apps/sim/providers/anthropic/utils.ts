import type {
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStreamEvent,
  Usage,
} from '@anthropic-ai/sdk/resources'
import { createLogger } from '@sim/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AnthropicUtils')

export interface AnthropicStreamUsage {
  input_tokens: number
  output_tokens: number
}

export function createReadableStreamFromAnthropicStream(
  anthropicStream: AsyncIterable<RawMessageStreamEvent>,
  onComplete?: (content: string, usage: AnthropicStreamUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of anthropicStream) {
          if (event.type === 'message_start') {
            const startEvent = event as RawMessageStartEvent
            const usage: Usage = startEvent.message.usage
            inputTokens = usage.input_tokens
          } else if (event.type === 'message_delta') {
            const deltaEvent = event as RawMessageDeltaEvent
            outputTokens = deltaEvent.usage.output_tokens
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            fullContent += text
            controller.enqueue(new TextEncoder().encode(text))
          }
        }

        if (onComplete) {
          onComplete(fullContent, { input_tokens: inputTokens, output_tokens: outputTokens })
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export function generateToolUseId(toolName: string): string {
  return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
}

export function checkForForcedToolUsage(
  response: any,
  toolChoice: any,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } | null {
  if (typeof toolChoice === 'object' && toolChoice !== null && Array.isArray(response.content)) {
    const toolUses = response.content.filter((item: any) => item.type === 'tool_use')

    if (toolUses.length > 0) {
      const adaptedToolCalls = toolUses.map((tool: any) => ({ name: tool.name }))
      const adaptedToolChoice =
        toolChoice.type === 'tool' ? { function: { name: toolChoice.name } } : toolChoice

      return trackForcedToolUsage(
        adaptedToolCalls,
        adaptedToolChoice,
        logger,
        'anthropic',
        forcedTools,
        usedForcedTools
      )
    }
  }
  return null
}
