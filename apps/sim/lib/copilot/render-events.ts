/**
 * Render events are the normalized event types sent to clients.
 * These are independent of the sim agent's internal event format.
 */

export type RenderEventType =
  | 'text_delta'
  | 'text_complete'
  | 'tool_pending'
  | 'tool_executing'
  | 'tool_success'
  | 'tool_error'
  | 'tool_result'
  | 'subagent_start'
  | 'subagent_text'
  | 'subagent_tool_call'
  | 'subagent_end'
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end'
  | 'message_start'
  | 'message_complete'
  | 'chat_id'
  | 'conversation_id'
  | 'error'
  | 'stream_status'

export interface BaseRenderEvent {
  type: RenderEventType
  timestamp?: number
}

export interface TextDeltaEvent extends BaseRenderEvent {
  type: 'text_delta'
  content: string
}

export interface TextCompleteEvent extends BaseRenderEvent {
  type: 'text_complete'
  content: string
}

export interface ToolPendingEvent extends BaseRenderEvent {
  type: 'tool_pending'
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  display?: {
    label: string
    icon?: string
  }
}

export interface ToolExecutingEvent extends BaseRenderEvent {
  type: 'tool_executing'
  toolCallId: string
  toolName: string
}

export interface ToolSuccessEvent extends BaseRenderEvent {
  type: 'tool_success'
  toolCallId: string
  toolName: string
  result?: unknown
  display?: {
    label: string
    icon?: string
  }
}

export interface ToolErrorEvent extends BaseRenderEvent {
  type: 'tool_error'
  toolCallId: string
  toolName: string
  error: string
  display?: {
    label: string
    icon?: string
  }
}

export interface ToolResultEvent extends BaseRenderEvent {
  type: 'tool_result'
  toolCallId: string
  success: boolean
  result?: unknown
  error?: string
  failedDependency?: boolean
  skipped?: boolean
}

export interface SubagentStartEvent extends BaseRenderEvent {
  type: 'subagent_start'
  parentToolCallId: string
  subagentName: string
}

export interface SubagentTextEvent extends BaseRenderEvent {
  type: 'subagent_text'
  parentToolCallId: string
  content: string
}

export interface SubagentToolCallEvent extends BaseRenderEvent {
  type: 'subagent_tool_call'
  parentToolCallId: string
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  state: 'pending' | 'executing' | 'success' | 'error'
  result?: unknown
  error?: string
}

export interface SubagentEndEvent extends BaseRenderEvent {
  type: 'subagent_end'
  parentToolCallId: string
}

export interface ThinkingStartEvent extends BaseRenderEvent {
  type: 'thinking_start'
}

export interface ThinkingDeltaEvent extends BaseRenderEvent {
  type: 'thinking_delta'
  content: string
}

export interface ThinkingEndEvent extends BaseRenderEvent {
  type: 'thinking_end'
}

export interface MessageStartEvent extends BaseRenderEvent {
  type: 'message_start'
  messageId: string
}

export interface MessageCompleteEvent extends BaseRenderEvent {
  type: 'message_complete'
  messageId: string
  content?: string
}

export interface ChatIdEvent extends BaseRenderEvent {
  type: 'chat_id'
  chatId: string
}

export interface ConversationIdEvent extends BaseRenderEvent {
  type: 'conversation_id'
  conversationId: string
}

export interface ErrorEvent extends BaseRenderEvent {
  type: 'error'
  error: string
  code?: string
}

export interface StreamStatusEvent extends BaseRenderEvent {
  type: 'stream_status'
  status: 'streaming' | 'complete' | 'error' | 'aborted'
  error?: string
}

export type RenderEvent =
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolPendingEvent
  | ToolExecutingEvent
  | ToolSuccessEvent
  | ToolErrorEvent
  | ToolResultEvent
  | SubagentStartEvent
  | SubagentTextEvent
  | SubagentToolCallEvent
  | SubagentEndEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  | MessageStartEvent
  | MessageCompleteEvent
  | ChatIdEvent
  | ConversationIdEvent
  | ErrorEvent
  | StreamStatusEvent

/**
 * Serialize a render event to SSE format
 */
export function serializeRenderEvent(event: RenderEvent): string {
  const eventWithTimestamp = {
    ...event,
    timestamp: event.timestamp || Date.now(),
  }
  return `event: ${event.type}\ndata: ${JSON.stringify(eventWithTimestamp)}\n\n`
}

/**
 * Parse an SSE chunk into a render event
 */
export function parseRenderEvent(chunk: string): RenderEvent | null {
  // SSE format: "event: <type>\ndata: <json>\n\n"
  const lines = chunk.trim().split('\n')
  let eventType: string | null = null
  let data: string | null = null

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7)
    } else if (line.startsWith('data: ')) {
      data = line.slice(6)
    }
  }

  if (!data) return null

  try {
    const parsed = JSON.parse(data)
    // If we extracted an event type from SSE, use it; otherwise use from data
    if (eventType && !parsed.type) {
      parsed.type = eventType
    }
    return parsed as RenderEvent
  } catch {
    return null
  }
}

/**
 * Create a text delta event
 */
export function createTextDelta(content: string): TextDeltaEvent {
  return { type: 'text_delta', content, timestamp: Date.now() }
}

/**
 * Create a tool pending event
 */
export function createToolPending(
  toolCallId: string,
  toolName: string,
  args?: Record<string, unknown>,
  display?: { label: string; icon?: string }
): ToolPendingEvent {
  return {
    type: 'tool_pending',
    toolCallId,
    toolName,
    args,
    display,
    timestamp: Date.now(),
  }
}

/**
 * Create a tool executing event
 */
export function createToolExecuting(toolCallId: string, toolName: string): ToolExecutingEvent {
  return { type: 'tool_executing', toolCallId, toolName, timestamp: Date.now() }
}

/**
 * Create a tool success event
 */
export function createToolSuccess(
  toolCallId: string,
  toolName: string,
  result?: unknown,
  display?: { label: string; icon?: string }
): ToolSuccessEvent {
  return {
    type: 'tool_success',
    toolCallId,
    toolName,
    result,
    display,
    timestamp: Date.now(),
  }
}

/**
 * Create a tool error event
 */
export function createToolError(
  toolCallId: string,
  toolName: string,
  error: string,
  display?: { label: string; icon?: string }
): ToolErrorEvent {
  return {
    type: 'tool_error',
    toolCallId,
    toolName,
    error,
    display,
    timestamp: Date.now(),
  }
}

/**
 * Create a message complete event
 */
export function createMessageComplete(messageId: string, content?: string): MessageCompleteEvent {
  return { type: 'message_complete', messageId, content, timestamp: Date.now() }
}

/**
 * Create a stream status event
 */
export function createStreamStatus(
  status: 'streaming' | 'complete' | 'error' | 'aborted',
  error?: string
): StreamStatusEvent {
  return { type: 'stream_status', status, error, timestamp: Date.now() }
}

/**
 * Create an error event
 */
export function createError(error: string, code?: string): ErrorEvent {
  return { type: 'error', error, code, timestamp: Date.now() }
}

