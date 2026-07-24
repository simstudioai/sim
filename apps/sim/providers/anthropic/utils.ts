import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources'
import { createLogger } from '@sim/logger'
import {
  type AnthropicUsageAccumulator,
  type AnthropicUsageLike,
  addAnthropicUsage,
  createAnthropicUsageAccumulator,
} from '@/providers/anthropic/usage'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AnthropicUtils')

export interface AnthropicStreamComplete {
  content: string
  usage: AnthropicUsageAccumulator
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
  let cancelled = false
  let streamIterator: AsyncIterator<RawMessageStreamEvent> | undefined

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      try {
        let fullContent = ''
        const thinkingBlocks: string[] = []
        let currentThinking = ''
        let usageSnapshot: AnthropicUsageLike = {}

        const flushThinkingBlock = () => {
          if (currentThinking) {
            thinkingBlocks.push(currentThinking)
            currentThinking = ''
          }
        }

        streamIterator = anthropicStream[Symbol.asyncIterator]()
        while (true) {
          const next = await streamIterator.next()
          if (next.done || cancelled) break
          const event = next.value
          if (event.type === 'message_start') {
            usageSnapshot = event.message.usage
            continue
          }

          if (event.type === 'message_delta') {
            usageSnapshot = {
              ...usageSnapshot,
              input_tokens: event.usage.input_tokens ?? usageSnapshot.input_tokens,
              output_tokens: event.usage.output_tokens ?? usageSnapshot.output_tokens,
              cache_read_input_tokens:
                event.usage.cache_read_input_tokens ?? usageSnapshot.cache_read_input_tokens,
              cache_creation_input_tokens:
                event.usage.cache_creation_input_tokens ??
                usageSnapshot.cache_creation_input_tokens,
            }
            continue
          }

          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'redacted_thinking') {
              flushThinkingBlock()
              thinkingBlocks.push('[redacted]')
            } else if (event.content_block.type === 'thinking') {
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

          const delta = event.delta

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

        if (cancelled) return
        flushThinkingBlock()

        if (onComplete) {
          const usage = createAnthropicUsageAccumulator()
          addAnthropicUsage(usage, usageSnapshot)
          onComplete({
            content: fullContent,
            usage,
            thinking: thinkingBlocks.filter(Boolean).join('\n\n'),
          })
        }

        controller.close()
      } catch (err) {
        if (!cancelled) {
          controller.error(err)
        }
      }
    },
    async cancel() {
      cancelled = true
      await streamIterator?.return?.()
    },
  })
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
