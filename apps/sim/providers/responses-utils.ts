import { createLogger } from '@sim/logger'
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
  parameters?: Record<string, any>
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

    if (message.content) {
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
export function convertToolsToResponses(tools: any[]): ResponsesToolDefinition[] {
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

function extractTextFromMessageItem(item: any): string {
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
    if (
      part &&
      (part.type === 'output_text' || part.type === 'text') &&
      typeof part.text === 'string'
    ) {
      textParts.push(part.text)
    }
  }

  return textParts.join('')
}

/**
 * Extracts plain text from Responses API output items.
 */
export function extractResponseText(output: unknown): string {
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
 * Converts Responses API output items into input items for subsequent calls.
 */
export function convertResponseOutputToInputItems(output: unknown): ResponsesInputItem[] {
  if (!Array.isArray(output)) {
    return []
  }

  const items: ResponsesInputItem[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue
    }

    if (item.type === 'message') {
      const text = extractTextFromMessageItem(item)
      if (text) {
        items.push({
          role: 'assistant',
          content: text,
        })
      }
      continue
    }

    if (item.type === 'function_call') {
      const callId = item.call_id ?? item.id
      const name = item.name ?? item.function?.name
      if (!callId || !name) {
        continue
      }

      const argumentsValue =
        typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {})

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
export function extractResponseToolCalls(output: unknown): ResponsesToolCall[] {
  if (!Array.isArray(output)) {
    return []
  }

  return output
    .map((item) => {
      if (!item || item.type !== 'function_call') {
        return null
      }

      const callId = item.call_id ?? item.id
      const name = item.name ?? item.function?.name
      if (!callId || !name) {
        return null
      }

      const argumentsValue =
        typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {})

      return {
        id: callId,
        name,
        arguments: argumentsValue,
      }
    })
    .filter(Boolean) as ResponsesToolCall[]
}

/**
 * Maps Responses API usage data to prompt/completion token counts.
 */
export function parseResponsesUsage(usage: any): ResponsesUsageTokens | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined
  }

  const inputTokens = Number(usage.input_tokens ?? 0)
  const outputTokens = Number(usage.output_tokens ?? 0)
  const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0)
  const reasoningTokens = Number(usage.output_tokens_details?.reasoning_tokens ?? 0)
  const completionTokens = outputTokens + reasoningTokens
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

            let event: any
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
              activeEventType === 'response.failed'
            ) {
              const message = event?.error?.message || 'Responses API stream error'
              controller.error(new Error(message))
              return
            }

            if (eventType === 'response.output_text.delta') {
              let deltaText = ''
              if (typeof event.delta === 'string') {
                deltaText = event.delta
              } else if (event.delta && typeof event.delta.text === 'string') {
                deltaText = event.delta.text
              } else if (typeof event.text === 'string') {
                deltaText = event.text
              }

              if (deltaText.length > 0) {
                fullContent += deltaText
                controller.enqueue(encoder.encode(deltaText))
              }
            }

            if (eventType === 'response.completed') {
              finalUsage = parseResponsesUsage(event?.response?.usage ?? event?.usage)
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
