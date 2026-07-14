import type {
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStreamEvent,
  Usage,
} from '@anthropic-ai/sdk/resources'
import { createLogger } from '@sim/logger'
import { randomFloat } from '@sim/utils/random'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AnthropicUtils')

export interface AnthropicStreamUsage {
  input_tokens: number
  output_tokens: number
}

export interface AnthropicStreamComplete {
  content: string
  usage: AnthropicStreamUsage
  /** Assembled thinking text for traces (redacted blocks become `[redacted]`). */
  thinking: string
}

/**
 * Converts an Anthropic Messages stream into an in-process
 * {@link AgentStreamEvent} object stream (`thinking_delta` + `text_delta`).
 * Tool_use / input_json deltas are ignored here — use
 * {@link createAnthropicStreamingToolLoopStream} for the live tool loop.
 */
export function createReadableStreamFromAnthropicStream(
  anthropicStream: AsyncIterable<RawMessageStreamEvent>,
  onComplete?: (result: AnthropicStreamComplete) => void
): ReadableStream<AgentStreamEvent> {
  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      try {
        let fullContent = ''
        const thinkingBlocks: string[] = []
        let currentThinking = ''
        let inputTokens = 0
        let outputTokens = 0

        const flushThinkingBlock = () => {
          if (currentThinking) {
            thinkingBlocks.push(currentThinking)
            currentThinking = ''
          }
        }

        for await (const event of anthropicStream) {
          if (event.type === 'message_start') {
            const startEvent = event as RawMessageStartEvent
            const usage: Usage = startEvent.message.usage
            inputTokens = usage.input_tokens
            continue
          }

          if (event.type === 'message_delta') {
            const deltaEvent = event as RawMessageDeltaEvent
            outputTokens = deltaEvent.usage.output_tokens
            continue
          }

          if (event.type === 'content_block_start') {
            const block = event.content_block as { type?: string }
            if (block?.type === 'redacted_thinking') {
              flushThinkingBlock()
              thinkingBlocks.push('[redacted]')
            } else if (block?.type === 'thinking') {
              flushThinkingBlock()
            }
            continue
          }

          if (event.type === 'content_block_stop') {
            flushThinkingBlock()
            continue
          }

          if (event.type !== 'content_block_delta') {
            continue
          }

          const delta = event.delta as {
            type?: string
            text?: string
            thinking?: string
          }

          if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            currentThinking += delta.thinking
            controller.enqueue({ type: 'thinking_delta', text: delta.thinking })
            continue
          }

          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            flushThinkingBlock()
            fullContent += delta.text
            controller.enqueue({ type: 'text_delta', text: delta.text, turn: 'final' })
          }
        }

        flushThinkingBlock()

        if (onComplete) {
          onComplete({
            content: fullContent,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            // Match enrichLastModelSegmentFromAnthropicResponse: join blocks with blank lines.
            thinking: thinkingBlocks.filter(Boolean).join('\n\n'),
          })
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export function generateToolUseId(toolName: string): string {
  return `${toolName}-${Date.now()}-${randomFloat().toString(36).substring(2, 7)}`
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
