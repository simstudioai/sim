/**
 * OpenAI Chat Completions → agent-events-v1.
 *
 * Capability-honest: emits `thinking_delta` only when the vendor streams a
 * reasoning field on the delta (`reasoning_content`, `reasoning`, etc.).
 * Non-reasoning models stay text-only. Tool_call starts emit when a name is
 * known (ids are synthesized when the vendor omits them, so the assembled
 * request stays self-consistent). Tool-call argument deltas are accumulated
 * for tool-loop history.
 */

import { createLogger } from '@sim/logger'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { AgentStreamEvent, TextDeltaTurn } from '@/providers/stream-events'
import { ensureToolCallId } from '@/providers/tool-call-id'

export interface OpenAICompatAssembledToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAICompatStreamComplete {
  content: string
  thinking: string
  /** DeepSeek-style CoT field accumulated from deltas. */
  reasoning_content?: string
  /** Groq-style reasoning field accumulated from deltas. */
  reasoning?: string
  usage: CompletionUsage
  /** Assembled when emitToolCallStarts is true (id + name + args). */
  toolCalls?: OpenAICompatAssembledToolCall[]
  /** Last finish_reason observed on the stream (e.g. `tool_calls`, `stop`, `length`). */
  finishReason?: string
}

export interface CreateOpenAICompatibleAgentEventStreamOptions {
  providerName: string
  /** Tag for answer text (default `final`). Use `intermediate` inside tool loops. */
  turn?: TextDeltaTurn
  /** Emit tool_call_start from delta.tool_calls when id+name known. Default false for no-tools path. */
  emitToolCallStarts?: boolean
  /**
   * When true, accumulate text but do not enqueue text_delta until the caller
   * flushes with a known turn tag (tool loops need this).
   */
  bufferTextDeltas?: boolean
  onComplete?: (result: OpenAICompatStreamComplete) => void
}

function extractDeltaReasoning(delta: Record<string, unknown> | undefined): {
  text: string
  reasoning_content?: string
  reasoning?: string
} {
  if (!delta) return { text: '' }

  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    return { text: delta.reasoning_content, reasoning_content: delta.reasoning_content }
  }
  if (typeof delta.reasoning === 'string' && delta.reasoning) {
    return { text: delta.reasoning, reasoning: delta.reasoning }
  }
  const nested = delta.reasoning
  if (
    nested &&
    typeof nested === 'object' &&
    typeof (nested as { text?: string }).text === 'string'
  ) {
    const text = (nested as { text: string }).text
    return { text, reasoning: text }
  }
  return { text: '' }
}

/**
 * Converts an OpenAI-compatible chat.completions stream into an in-process
 * {@link AgentStreamEvent} object stream.
 */
export function createOpenAICompatibleAgentEventStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  options: CreateOpenAICompatibleAgentEventStreamOptions
): ReadableStream<AgentStreamEvent> {
  const {
    providerName,
    turn = 'final',
    emitToolCallStarts = false,
    bufferTextDeltas = false,
    onComplete,
  } = options
  const streamLogger = createLogger(`${providerName}Utils`)

  return new ReadableStream<AgentStreamEvent>({
    async start(controller) {
      let fullContent = ''
      let fullThinking = ''
      let reasoningContent = ''
      let reasoning = ''
      let promptTokens = 0
      let completionTokens = 0
      let totalTokens = 0
      let finishReason: string | undefined
      const seenToolIds = new Set<string>()
      const toolBuffers = new Map<
        number,
        { id?: string; name?: string; args: string; started: boolean }
      >()

      try {
        for await (const chunk of stream) {
          /**
           * Groq puts stream usage under `x_groq.usage` on the final chunk
           * instead of the OpenAI `usage` field; accept either shape.
           */
          const usage =
            chunk.usage ??
            (chunk as { x_groq?: { usage?: CompletionUsage } }).x_groq?.usage ??
            undefined
          if (usage) {
            promptTokens = usage.prompt_tokens ?? 0
            completionTokens = usage.completion_tokens ?? 0
            totalTokens = usage.total_tokens ?? 0
          }

          const choice = chunk.choices?.[0]
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
          }
          const delta = choice?.delta as Record<string, unknown> | undefined

          const extracted = extractDeltaReasoning(delta)
          if (extracted.text) {
            fullThinking += extracted.text
            if (extracted.reasoning_content) reasoningContent += extracted.reasoning_content
            if (extracted.reasoning) reasoning += extracted.reasoning
            controller.enqueue({ type: 'thinking_delta', text: extracted.text })
          }

          const content = typeof delta?.content === 'string' ? delta.content : ''
          if (content) {
            fullContent += content
            if (!bufferTextDeltas) {
              controller.enqueue({ type: 'text_delta', text: content, turn })
            }
          }

          if (emitToolCallStarts && Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls as Array<{
              index?: number
              id?: string
              type?: string
              function?: { name?: string; arguments?: string }
            }>) {
              const index = typeof tc.index === 'number' ? tc.index : 0
              const buf = toolBuffers.get(index) ?? {
                id: undefined,
                name: undefined,
                args: '',
                started: false,
              }
              if (tc.id) buf.id = tc.id
              if (tc.function?.name) buf.name = tc.function.name
              /**
               * Some compat vendors stream tool calls without ids. Synthesize
               * an execution-local id as soon as the name is known so the call
               * is not dropped — the assembled request only needs ids that are
               * self-consistent between `tool_calls` and `tool` messages.
               */
              if (!buf.id && buf.name) {
                buf.id = ensureToolCallId(undefined, providerName.toLowerCase())
              }
              if (typeof tc.function?.arguments === 'string') {
                buf.args += tc.function.arguments
              }
              toolBuffers.set(index, buf)

              if (buf.id && buf.name && !buf.started && !seenToolIds.has(buf.id)) {
                buf.started = true
                seenToolIds.add(buf.id)
                controller.enqueue({ type: 'tool_call_start', id: buf.id, name: buf.name })
              }
            }
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            streamLogger.warn(`${providerName} stream completed without usage data`)
          }
          const toolCalls: OpenAICompatAssembledToolCall[] = []
          if (emitToolCallStarts) {
            for (const [, buf] of [...toolBuffers.entries()].sort(([a], [b]) => a - b)) {
              if (!buf.id || !buf.name) continue
              toolCalls.push({
                id: buf.id,
                type: 'function',
                function: { name: buf.name, arguments: buf.args || '{}' },
              })
            }
          }
          onComplete({
            content: fullContent,
            thinking: fullThinking,
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            ...(reasoning ? { reasoning } : {}),
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens || promptTokens + completionTokens,
            },
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
            ...(finishReason ? { finishReason } : {}),
          })
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
