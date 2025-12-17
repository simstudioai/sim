import { createLogger } from '@/lib/logs/console/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('XAIProvider')

/**
 * Helper to wrap XAI (OpenAI-compatible) streaming into a browser-friendly
 * ReadableStream of raw assistant text chunks.
 */
export function createReadableStreamFromXAIStream(xaiStream: any): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of xaiStream) {
          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            controller.enqueue(new TextEncoder().encode(content))
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
 * Creates a response format payload for XAI API requests.
 */
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

/**
 * Helper function to check for forced tool usage in responses.
 */
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
