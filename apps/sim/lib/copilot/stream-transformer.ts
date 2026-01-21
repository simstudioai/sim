import { createLogger } from '@sim/logger'
import type { RenderEvent } from './render-events'

const logger = createLogger('StreamTransformer')

export interface TransformStreamContext {
  streamId: string
  chatId: string
  userId: string
  workflowId: string
  userMessageId: string
  assistantMessageId: string

  /** Callback for each render event - handles both client delivery and persistence */
  onRenderEvent: (event: RenderEvent) => Promise<void>

  /** Callback for persistence operations */
  onPersist?: (data: { type: string; [key: string]: unknown }) => Promise<void>

  /** Check if stream should be aborted */
  isAborted: () => boolean | Promise<boolean>
}

interface SimAgentEvent {
  type?: string
  event?: string
  data?: unknown
  [key: string]: unknown
}

/**
 * Transform a sim agent SSE stream into normalized render events.
 * This function consumes the entire stream and emits events via callbacks.
 */
export async function transformStream(
  body: ReadableStream<Uint8Array>,
  context: TransformStreamContext
): Promise<void> {
  const { onRenderEvent, onPersist, isAborted } = context

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      // Check abort signal
      const shouldAbort = await Promise.resolve(isAborted())
      if (shouldAbort) {
        logger.info('Stream aborted by signal', { streamId: context.streamId })
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE messages (separated by double newlines)
      const messages = buffer.split('\n\n')
      buffer = messages.pop() || '' // Keep incomplete message in buffer

      for (const message of messages) {
        if (!message.trim()) continue

        const events = parseSimAgentMessage(message)
        for (const simEvent of events) {
          const renderEvents = transformSimAgentEvent(simEvent, context)
          for (const renderEvent of renderEvents) {
            await onRenderEvent(renderEvent)
          }
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      const events = parseSimAgentMessage(buffer)
      for (const simEvent of events) {
        const renderEvents = transformSimAgentEvent(simEvent, context)
        for (const renderEvent of renderEvents) {
          await onRenderEvent(renderEvent)
        }
      }
    }

    // Emit message complete
    await onRenderEvent({
      type: 'message_complete',
      messageId: context.assistantMessageId,
      timestamp: Date.now(),
    })

    // Notify persistence layer
    if (onPersist) {
      await onPersist({ type: 'message_complete', messageId: context.assistantMessageId })
    }
  } catch (error) {
    logger.error('Stream transform error', { streamId: context.streamId, error })

    await onRenderEvent({
      type: 'error',
      error: error instanceof Error ? error.message : 'Stream processing error',
      timestamp: Date.now(),
    })

    throw error
  } finally {
    reader.releaseLock()
  }
}

/**
 * Parse a raw SSE message into sim agent events
 */
function parseSimAgentMessage(message: string): SimAgentEvent[] {
  const events: SimAgentEvent[] = []
  const lines = message.split('\n')

  let currentEvent: string | null = null
  let currentData: string[] = []

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      // If we have accumulated data, emit previous event
      if (currentData.length > 0) {
        const dataStr = currentData.join('\n')
        const parsed = tryParseJson(dataStr)
        if (parsed) {
          events.push({ ...parsed, event: currentEvent || undefined })
        }
        currentData = []
      }
      currentEvent = line.slice(7)
    } else if (line.startsWith('data: ')) {
      currentData.push(line.slice(6))
    } else if (line === '' && currentData.length > 0) {
      // Empty line signals end of event
      const dataStr = currentData.join('\n')
      const parsed = tryParseJson(dataStr)
      if (parsed) {
        events.push({ ...parsed, event: currentEvent || undefined })
      }
      currentEvent = null
      currentData = []
    }
  }

  // Handle remaining data
  if (currentData.length > 0) {
    const dataStr = currentData.join('\n')
    const parsed = tryParseJson(dataStr)
    if (parsed) {
      events.push({ ...parsed, event: currentEvent || undefined })
    }
  }

  return events
}

function tryParseJson(str: string): Record<string, unknown> | null {
  if (str === '[DONE]') return null
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

/**
 * Transform a sim agent event into one or more render events
 */
function transformSimAgentEvent(
  simEvent: SimAgentEvent,
  context: TransformStreamContext
): RenderEvent[] {
  const eventType = simEvent.type || simEvent.event
  const events: RenderEvent[] = []
  const timestamp = Date.now()

  switch (eventType) {
    // Text content events
    case 'content_block_delta':
    case 'text_delta':
    case 'delta': {
      const delta = (simEvent.delta as Record<string, unknown>) || simEvent
      const text = (delta.text as string) || (delta.content as string) || (simEvent.text as string)
      if (text) {
        events.push({ type: 'text_delta', content: text, timestamp })
      }
      break
    }

    case 'content_block_stop':
    case 'text_complete': {
      events.push({
        type: 'text_complete',
        content: (simEvent.content as string) || '',
        timestamp,
      })
      break
    }

    // Tool call events
    case 'tool_call':
    case 'tool_use': {
      const data = (simEvent.data as Record<string, unknown>) || simEvent
      const toolCallId = (data.id as string) || (simEvent.id as string)
      const toolName = (data.name as string) || (simEvent.name as string)
      const args = (data.arguments as Record<string, unknown>) || (data.input as Record<string, unknown>)

      if (toolCallId && toolName) {
        events.push({
          type: 'tool_pending',
          toolCallId,
          toolName,
          args,
          timestamp,
        })
      }
      break
    }

    case 'tool_executing': {
      const toolCallId = (simEvent.toolCallId as string) || (simEvent.id as string)
      const toolName = (simEvent.toolName as string) || (simEvent.name as string) || ''

      if (toolCallId) {
        events.push({
          type: 'tool_executing',
          toolCallId,
          toolName,
          timestamp,
        })
      }
      break
    }

    case 'tool_result': {
      const toolCallId = (simEvent.toolCallId as string) || (simEvent.id as string)
      const success = simEvent.success as boolean
      const result = simEvent.result
      const error = simEvent.error as string | undefined

      if (toolCallId) {
        events.push({
          type: 'tool_result',
          toolCallId,
          success: success !== false,
          result,
          error,
          failedDependency: simEvent.failedDependency as boolean | undefined,
          skipped: (simEvent.result as Record<string, unknown>)?.skipped as boolean | undefined,
          timestamp,
        })

        // Also emit success/error event for UI
        if (success !== false) {
          events.push({
            type: 'tool_success',
            toolCallId,
            toolName: (simEvent.toolName as string) || '',
            result,
            timestamp,
          })
        } else {
          events.push({
            type: 'tool_error',
            toolCallId,
            toolName: (simEvent.toolName as string) || '',
            error: error || 'Tool execution failed',
            timestamp,
          })
        }
      }
      break
    }

    // Subagent events
    case 'subagent_start': {
      events.push({
        type: 'subagent_start',
        parentToolCallId: simEvent.parentToolCallId as string,
        subagentName: simEvent.subagentName as string,
        timestamp,
      })
      break
    }

    case 'subagent_text':
    case 'subagent_delta': {
      events.push({
        type: 'subagent_text',
        parentToolCallId: simEvent.parentToolCallId as string,
        content: (simEvent.content as string) || (simEvent.text as string) || '',
        timestamp,
      })
      break
    }

    case 'subagent_tool_call': {
      events.push({
        type: 'subagent_tool_call',
        parentToolCallId: simEvent.parentToolCallId as string,
        toolCallId: simEvent.toolCallId as string,
        toolName: simEvent.toolName as string,
        args: simEvent.args as Record<string, unknown> | undefined,
        state: (simEvent.state as 'pending' | 'executing' | 'success' | 'error') || 'pending',
        result: simEvent.result,
        error: simEvent.error as string | undefined,
        timestamp,
      })
      break
    }

    case 'subagent_end': {
      events.push({
        type: 'subagent_end',
        parentToolCallId: simEvent.parentToolCallId as string,
        timestamp,
      })
      break
    }

    // Thinking events (for extended thinking models)
    case 'thinking_start':
    case 'thinking': {
      if (simEvent.type === 'thinking_start' || !simEvent.content) {
        events.push({ type: 'thinking_start', timestamp })
      }
      if (simEvent.content) {
        events.push({
          type: 'thinking_delta',
          content: simEvent.content as string,
          timestamp,
        })
      }
      break
    }

    case 'thinking_delta': {
      events.push({
        type: 'thinking_delta',
        content: (simEvent.content as string) || '',
        timestamp,
      })
      break
    }

    case 'thinking_end':
    case 'thinking_complete': {
      events.push({ type: 'thinking_end', timestamp })
      break
    }

    // Message lifecycle events
    case 'message_start': {
      events.push({
        type: 'message_start',
        messageId: (simEvent.messageId as string) || context.assistantMessageId,
        timestamp,
      })
      break
    }

    case 'message_stop':
    case 'message_complete':
    case 'message_delta': {
      if (eventType === 'message_complete' || eventType === 'message_stop') {
        events.push({
          type: 'message_complete',
          messageId: (simEvent.messageId as string) || context.assistantMessageId,
          content: simEvent.content as string | undefined,
          timestamp,
        })
      }
      break
    }

    // Metadata events
    case 'chat_id': {
      events.push({
        type: 'chat_id',
        chatId: simEvent.chatId as string,
        timestamp,
      })
      break
    }

    case 'conversation_id': {
      events.push({
        type: 'conversation_id',
        conversationId: simEvent.conversationId as string,
        timestamp,
      })
      break
    }

    // Error events
    case 'error': {
      events.push({
        type: 'error',
        error: (simEvent.error as string) || (simEvent.message as string) || 'Unknown error',
        code: simEvent.code as string | undefined,
        timestamp,
      })
      break
    }

    default: {
      // Log unhandled event types for debugging
      if (eventType && eventType !== 'ping') {
        logger.debug('Unhandled sim agent event type', { eventType, streamId: context.streamId })
      }
    }
  }

  return events
}
