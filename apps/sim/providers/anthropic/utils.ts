import type {
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStreamEvent,
  TextBlockParam,
  Tool,
  Usage,
} from '@anthropic-ai/sdk/resources'
import { createLogger } from '@sim/logger'
import { randomFloat } from '@sim/utils/random'
import { shouldCacheStaticPrefix } from '@/providers/prompt-cache'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AnthropicUtils')

/** Mutable view of the parts of the Anthropic payload that carry cache breakpoints. */
interface AnthropicCacheablePayload {
  system?: string | Array<TextBlockParam>
}

/**
 * Marks the static request prefix (system prompt + tools) with an ephemeral
 * cache breakpoint when {@link shouldCacheStaticPrefix} deems it worthwhile, so
 * repeated calls reuse the cached prefix. Mutates `payload.system` (string → a
 * single cached text block) and the last entry of `tools` in place; a no-op when
 * the prefix is too small or not present. Call after any structured-output
 * mutation of `payload.system`, since it may replace the string with a block array.
 *
 * The worthiness gate is sized on the LARGER of the final `payload.system`
 * (which may include appended structured-output schema text) and the original
 * `systemPrompt` (non-empty even when the no-messages path relocates the system
 * text into a user message and blanks `payload.system` — the tools prefix is
 * still worth caching there).
 *
 * @param payload - Anthropic request payload; `system` is mutated in place.
 * @param tools - Anthropic tool definitions; the last entry is mutated in place.
 * @param systemPrompt - The original request system prompt, used only for sizing.
 */
export function applyAnthropicPromptCache(
  payload: AnthropicCacheablePayload,
  tools: Tool[] | undefined,
  systemPrompt: string | null | undefined
): void {
  const payloadSystem = typeof payload.system === 'string' ? payload.system : ''

  const gateSystem =
    payloadSystem.length >= (systemPrompt?.length ?? 0) ? payloadSystem : systemPrompt

  const shouldCache = shouldCacheStaticPrefix({
    systemPrompt: gateSystem,
    hasTools: !!tools?.length,
    toolsApproxChars: tools ? JSON.stringify(tools).length : 0,
  })
  if (!shouldCache) {
    return
  }

  if (payloadSystem.length > 0) {
    payload.system = [{ type: 'text', text: payloadSystem, cache_control: { type: 'ephemeral' } }]
  }

  if (tools?.length) {
    const lastIndex = tools.length - 1
    tools[lastIndex] = { ...tools[lastIndex], cache_control: { type: 'ephemeral' } }
  }
}

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
