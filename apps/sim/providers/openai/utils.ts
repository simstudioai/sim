import { createLogger } from '@sim/logger'
import type OpenAI from 'openai'
import type { Message } from '@/providers/types'

const logger = createLogger('ResponsesUtils')

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

export type ResponsesInputItem =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string
    }
  | {
      type: 'function_call'
      call_id: string
      name: string
      arguments: string
    }
  | {
      type: 'function_call_output'
      call_id: string
      output: string
    }

export interface ResponsesToolDefinition {
  type: 'function'
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

/**
 * Converts chat-style messages into Responses API input items.
 */
export function buildResponsesInputFromMessages(messages: Message[]): ResponsesInputItem[] {
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

    if (
      message.content &&
      (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    ) {
      input.push({
        role: message.role,
        content: message.content,
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
): 'auto' | 'none' | { type: 'function'; name: string } | undefined {
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

function extractTextFromMessageItem(item: Record<string, unknown>): string {
  if (!item) {
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
    if (!part || typeof part !== 'object') {
      continue
    }

    if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
      textParts.push(part.text)
      continue
    }

    if (part.type === 'output_json') {
      if (typeof part.text === 'string') {
        textParts.push(part.text)
      } else if (part.json !== undefined) {
        textParts.push(JSON.stringify(part.json))
      }
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

    const text = extractTextFromMessageItem(item as unknown as Record<string, unknown>)
    if (text) {
      textParts.push(text)
    }
  }

  return textParts.join('')
}

/**
 * Converts Responses API output items into input items for subsequent calls.
 */
export function convertResponseOutputToInputItems(
  output: OpenAI.Responses.ResponseOutputItem[]
): ResponsesInputItem[] {
  if (!Array.isArray(output)) {
    return []
  }

  const items: ResponsesInputItem[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue
    }

    if (item.type === 'message') {
      const text = extractTextFromMessageItem(item as unknown as Record<string, unknown>)
      if (text) {
        items.push({
          role: 'assistant',
          content: text,
        })
      }

      // Handle Chat Completions-style tool_calls nested under message items
      const msgRecord = item as unknown as Record<string, unknown>
      const toolCalls = Array.isArray(msgRecord.tool_calls) ? msgRecord.tool_calls : []
      for (const toolCall of toolCalls) {
        const tc = toolCall as Record<string, unknown>
        const fn = tc.function as Record<string, unknown> | undefined
        const callId = tc.id as string | undefined
        const name = (fn?.name ?? tc.name) as string | undefined
        if (!callId || !name) {
          continue
        }

        const argumentsValue =
          typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {})

        items.push({
          type: 'function_call',
          call_id: callId,
          name,
          arguments: argumentsValue,
        })
      }

      continue
    }

    if (item.type === 'function_call') {
      const fc = item as OpenAI.Responses.ResponseFunctionToolCall
      const fcRecord = item as unknown as Record<string, unknown>
      const callId = fc.call_id ?? (fcRecord.id as string | undefined)
      const name =
        fc.name ??
        ((fcRecord.function as Record<string, unknown> | undefined)?.name as string | undefined)
      if (!callId || !name) {
        continue
      }

      const argumentsValue =
        typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments ?? {})

      items.push({
        type: 'function_call',
        call_id: callId,
        name,
        arguments: argumentsValue,
      })
    }
  }

  return items
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
    if (!item || typeof item !== 'object') {
      continue
    }

    if (item.type === 'function_call') {
      const fc = item as OpenAI.Responses.ResponseFunctionToolCall
      const fcRecord = item as unknown as Record<string, unknown>
      const callId = fc.call_id ?? (fcRecord.id as string | undefined)
      const name =
        fc.name ??
        ((fcRecord.function as Record<string, unknown> | undefined)?.name as string | undefined)
      if (!callId || !name) {
        continue
      }

      const argumentsValue =
        typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments ?? {})

      toolCalls.push({
        id: callId,
        name,
        arguments: argumentsValue,
      })
      continue
    }

    // Handle Chat Completions-style tool_calls nested under message items
    const msgRecord = item as unknown as Record<string, unknown>
    if (item.type === 'message' && Array.isArray(msgRecord.tool_calls)) {
      for (const toolCall of msgRecord.tool_calls) {
        const tc = toolCall as Record<string, unknown>
        const fn = tc.function as Record<string, unknown> | undefined
        const callId = tc.id as string | undefined
        const name = (fn?.name ?? tc.name) as string | undefined
        if (!callId || !name) {
          continue
        }

        const argumentsValue =
          typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {})

        toolCalls.push({
          id: callId,
          name,
          arguments: argumentsValue,
        })
      }
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
 * Creates a ReadableStream from a Responses API SSE stream.
 */
export function createReadableStreamFromResponses(
  response: Response,
  onComplete?: (content: string, usage?: ResponsesUsageTokens) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let finalUsage: ResponsesUsageTokens | undefined
  let activeEventType: string | undefined
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = response.body?.getReader()
      if (!reader) {
        controller.close()
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) {
              continue
            }

            if (trimmed.startsWith('event:')) {
              activeEventType = trimmed.slice(6).trim()
              continue
            }

            if (!trimmed.startsWith('data:')) {
              continue
            }

            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') {
              continue
            }

            let event: Record<string, unknown>
            try {
              event = JSON.parse(data)
            } catch (error) {
              logger.debug('Skipping non-JSON response stream chunk', {
                data: data.slice(0, 200),
                error,
              })
              continue
            }

            const eventType = event?.type ?? activeEventType

            if (
              eventType === 'response.error' ||
              eventType === 'error' ||
              eventType === 'response.failed'
            ) {
              const errorObj = event.error as Record<string, unknown> | undefined
              const message = (errorObj?.message as string) || 'Responses API stream error'
              controller.error(new Error(message))
              return
            }

            if (
              eventType === 'response.output_text.delta' ||
              eventType === 'response.output_json.delta'
            ) {
              let deltaText = ''
              const delta = event.delta as string | Record<string, unknown> | undefined
              if (typeof delta === 'string') {
                deltaText = delta
              } else if (delta && typeof delta.text === 'string') {
                deltaText = delta.text
              } else if (delta && delta.json !== undefined) {
                deltaText = JSON.stringify(delta.json)
              } else if (event.json !== undefined) {
                deltaText = JSON.stringify(event.json)
              } else if (typeof event.text === 'string') {
                deltaText = event.text
              }

              if (deltaText.length > 0) {
                fullContent += deltaText
                controller.enqueue(encoder.encode(deltaText))
              }
            }

            if (eventType === 'response.completed') {
              const responseObj = event.response as Record<string, unknown> | undefined
              const usageData = (responseObj?.usage ?? event.usage) as
                | OpenAI.Responses.ResponseUsage
                | undefined
              finalUsage = parseResponsesUsage(usageData)
            }
          }
        }

        if (onComplete) {
          onComplete(fullContent, finalUsage)
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
  })
}
