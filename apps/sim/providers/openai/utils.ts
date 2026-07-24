import type OpenAI from 'openai'
import { Stream } from 'openai/streaming'
import { buildOpenAIMessageContent } from '@/providers/attachments'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { Message } from '@/providers/types'

export interface ResponsesUsageTokens {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
}

export interface ResponsesToolCall {
  id: string
  name: string
  arguments: string
}

export type ResponsesStreamEvent = OpenAI.Responses.ResponseStreamEvent

export type ResponsesInputItem = OpenAI.Responses.ResponseInputItem

/**
 * Identifies the one incomplete Responses status that still contains a valid
 * truncated answer: the configured output-token cap was reached.
 */
export function isMaxOutputTokensIncompleteResponse(response: OpenAI.Responses.Response): boolean {
  return (
    response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens'
  )
}

/**
 * Checks the terminal Responses output for a function call, including one
 * whose arguments or status remain incomplete.
 */
export function responseContainsFunctionCall(response: OpenAI.Responses.Response): boolean {
  return response.output.some((item) => item.type === 'function_call')
}

/**
 * Detects documented Responses stream events that prove function-call
 * generation started, even when the terminal output omits the partial item.
 */
export function isResponseFunctionCallEvent(event: ResponsesStreamEvent): boolean {
  return (
    (event.type === 'response.output_item.added' && event.item.type === 'function_call') ||
    event.type === 'response.function_call_arguments.delta' ||
    event.type === 'response.function_call_arguments.done'
  )
}

/**
 * Parses a Responses API SSE body with the official OpenAI stream decoder.
 */
export async function* iterateResponsesStreamEvents(
  response: Response,
  abortSignal?: AbortSignal
): AsyncGenerator<ResponsesStreamEvent> {
  const parserController = new AbortController()
  const abortParser = () => parserController.abort(abortSignal?.reason)

  if (abortSignal?.aborted) {
    abortParser()
  } else {
    abortSignal?.addEventListener('abort', abortParser, { once: true })
  }

  try {
    const stream = Stream.fromSSEResponse<ResponsesStreamEvent>(response, parserController)
    for await (const event of stream) {
      yield event
    }
  } finally {
    abortSignal?.removeEventListener('abort', abortParser)
    if (!parserController.signal.aborted) {
      parserController.abort()
    }
  }
}

export interface ResponsesToolDefinition {
  type: 'function'
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export type ResponsesToolChoice = 'auto' | 'none' | { type: 'function'; name: string }

/**
 * Converts chat-style messages into Responses API input items.
 */
export function buildResponsesInputFromMessages(
  messages: Message[],
  providerId = 'openai'
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = []

  for (const message of messages) {
    if (message.role === 'tool' && message.tool_call_id) {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content ?? '',
      })
      continue
    }

    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      const content =
        message.role === 'user'
          ? buildOpenAIMessageContent(message.content, message.files, providerId)
          : (message.content ?? '')
      if (
        (typeof content === 'string' && !content) ||
        (Array.isArray(content) && content.length === 0)
      ) {
        continue
      }

      input.push({
        role: message.role,
        content,
      })
    }

    if (message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })
      }
    }
  }

  return input
}

/**
 * Converts tool definitions to the Responses API format.
 */
export function convertToolsToResponses(
  tools: Array<{
    type?: string
    name?: string
    description?: string
    parameters?: Record<string, unknown>
    function?: { name: string; description?: string; parameters?: Record<string, unknown> }
  }>
): ResponsesToolDefinition[] {
  return tools
    .map((tool) => {
      const name = tool.function?.name ?? tool.name
      if (!name) {
        return null
      }

      return {
        type: 'function' as const,
        name,
        description: tool.function?.description ?? tool.description,
        parameters: tool.function?.parameters ?? tool.parameters,
      }
    })
    .filter(Boolean) as ResponsesToolDefinition[]
}

/**
 * Converts tool_choice to the Responses API format.
 */
export function toResponsesToolChoice(
  toolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function?: { name: string }; name?: string }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } }
    | undefined
): ResponsesToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  if (toolChoice.type === 'function') {
    const name = toolChoice.name ?? toolChoice.function?.name
    return name ? { type: 'function', name } : undefined
  }

  return 'auto'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractTextFromMessageItem(item: unknown): string {
  if (!isRecord(item)) {
    return ''
  }

  if (typeof item.content === 'string') {
    return item.content
  }

  if (!Array.isArray(item.content)) {
    return ''
  }

  const textParts: string[] = []
  for (const part of item.content) {
    if (!isRecord(part)) {
      continue
    }

    if (part.type === 'output_text' && typeof part.text === 'string') {
      textParts.push(part.text)
    } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
      textParts.push(part.refusal)
    }
  }

  return textParts.join('')
}

/**
 * Extracts plain text from Responses API output items.
 */
export function extractResponseText(output: OpenAI.Responses.ResponseOutputItem[]): string {
  if (!Array.isArray(output)) {
    return ''
  }

  const textParts: string[] = []
  for (const item of output) {
    if (item?.type !== 'message') {
      continue
    }

    const text = extractTextFromMessageItem(item)
    if (text) {
      textParts.push(text)
    }
  }

  return textParts.join('')
}

/**
 * Extracts reasoning summary text from Responses API output items. Reasoning
 * items (emitted by o1/o3/gpt-5) carry a `summary[]` of `{ type, text }` entries
 * — we join the text for trace display. The raw `encrypted_content` is left
 * alone; it's opaque plumbing for round-tripping across turns.
 */
export function extractResponseReasoning(output: OpenAI.Responses.ResponseOutputItem[]): string {
  if (!Array.isArray(output)) return ''

  const parts: string[] = []
  for (const item of output) {
    if (!item || item.type !== 'reasoning') continue
    for (const entry of item.summary) {
      if (entry.text.length > 0) parts.push(entry.text)
    }
  }
  return parts.join('\n\n')
}

/**
 * Converts Responses API output items into input items for subsequent calls.
 */
export function convertResponseOutputToInputItems(
  output: OpenAI.Responses.ResponseOutputItem[]
): ResponsesInputItem[] {
  return Array.isArray(output) ? output : []
}

/**
 * Extracts tool calls from Responses API output items.
 */
export function extractResponseToolCalls(
  output: OpenAI.Responses.ResponseOutputItem[]
): ResponsesToolCall[] {
  if (!Array.isArray(output)) {
    return []
  }

  const toolCalls: ResponsesToolCall[] = []

  for (const item of output) {
    if (!isRecord(item)) {
      continue
    }

    if (item.type === 'function_call') {
      const fc = item as OpenAI.Responses.ResponseFunctionToolCall
      if (!fc.call_id || !fc.name) {
        continue
      }

      const argumentsValue =
        typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments ?? {})

      toolCalls.push({
        id: fc.call_id,
        name: fc.name,
        arguments: argumentsValue,
      })
    }
  }

  return toolCalls
}

/**
 * Maps Responses API usage data to prompt/completion token counts.
 *
 * Note: output_tokens is expected to include reasoning tokens; fall back to reasoning_tokens
 * when output_tokens is missing or zero.
 */
export function parseResponsesUsage(
  usage: OpenAI.Responses.ResponseUsage | undefined
): ResponsesUsageTokens | undefined {
  if (!usage) {
    return undefined
  }

  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0
  const completionTokens = Math.max(outputTokens, reasoningTokens)
  const totalTokens = inputTokens + completionTokens

  return {
    promptTokens: inputTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
  }
}

/**
 * Creates an agent-events-v1 stream from a Responses API SSE stream.
 *
 * Capability-honest: emits `thinking_delta` only for streamable reasoning
 * *summary* deltas (not encrypted_content / raw CoT). If the API only
 * surfaces reasoning at completion, live thinking may be empty — traces still
 * use extractResponseReasoning post-hoc.
 */
export function createReadableStreamFromResponses(
  response: Response,
  onComplete?: (content: string, usage?: ResponsesUsageTokens, thinking?: string) => void
): ReadableStream<AgentStreamEvent> {
  const streamAbortController = new AbortController()

  return new ReadableStream<AgentStreamEvent>({
    start(controller) {
      void (async () => {
        let fullContent = ''
        let fullThinking = ''
        let finalUsage: ResponsesUsageTokens | undefined
        let completed = false
        let sawFunctionCall = false

        try {
          for await (const event of iterateResponsesStreamEvents(
            response,
            streamAbortController.signal
          )) {
            if (isResponseFunctionCallEvent(event)) {
              sawFunctionCall = true
            }
            if (event.type === 'error') {
              throw new Error(event.message || 'OpenAI Responses stream error')
            }
            if (event.type === 'response.failed') {
              throw new Error(event.response.error?.message || 'OpenAI Responses stream failed')
            }
            if (event.type === 'response.incomplete') {
              const reason = event.response.incomplete_details?.reason ?? 'unknown'
              if (
                !isMaxOutputTokensIncompleteResponse(event.response) ||
                sawFunctionCall ||
                responseContainsFunctionCall(event.response)
              ) {
                throw new Error(`OpenAI Responses stream incomplete: ${reason}`)
              }
              finalUsage = parseResponsesUsage(event.response.usage)
              completed = true
              continue
            }
            if (event.type === 'response.reasoning_summary_text.delta') {
              if (event.delta) {
                fullThinking += event.delta
                controller.enqueue({ type: 'thinking_delta', text: event.delta })
              }
              continue
            }
            if (event.type === 'response.output_text.delta') {
              if (event.delta) {
                fullContent += event.delta
                controller.enqueue({ type: 'text_delta', text: event.delta, turn: 'final' })
              }
              continue
            }
            if (event.type === 'response.refusal.delta') {
              if (event.delta) {
                fullContent += event.delta
                controller.enqueue({ type: 'text_delta', text: event.delta, turn: 'final' })
              }
              continue
            }
            if (event.type === 'response.completed') {
              finalUsage = parseResponsesUsage(event.response.usage)
              completed = true
            }
          }

          if (!completed) {
            throw new Error('OpenAI Responses stream ended without a completed response')
          }

          onComplete?.(fullContent, finalUsage, fullThinking || undefined)
          controller.close()
        } catch (error) {
          if (!streamAbortController.signal.aborted) {
            controller.error(error)
          }
        }
      })()
    },
    cancel(reason) {
      streamAbortController.abort(reason)
    },
  })
}
