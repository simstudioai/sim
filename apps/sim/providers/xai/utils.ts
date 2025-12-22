import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { createLogger } from '@/lib/logs/console/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('XAIUtils')

export function createReadableStreamFromXAIStream(
  xaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of xaiStream) {
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0
            completionTokens = chunk.usage.completion_tokens ?? 0
            totalTokens = chunk.usage.total_tokens ?? 0
          }

          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            logger.warn('xAI stream completed without usage data')
          }
          onComplete(fullContent, {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens || promptTokens + completionTokens,
          })
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

export function createResponseFormatPayload(
  basePayload: any,
  allMessages: any[],
  responseFormat: any,
  currentMessages?: any[]
) {
  const payload = {
    ...basePayload,
    messages: currentMessages || allMessages,
  }

  if (responseFormat) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: responseFormat.name || 'structured_response',
        schema: responseFormat.schema || responseFormat,
        strict: responseFormat.strict !== false,
      },
    }
  }

  return payload
}

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
      'xai',
      forcedTools,
      updatedUsedForcedTools
    )
    hasUsedForcedTool = result.hasUsedForcedTool
    updatedUsedForcedTools = result.usedForcedTools
  }

  return { hasUsedForcedTool, usedForcedTools: updatedUsedForcedTools }
}
