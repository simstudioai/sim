import { createLogger } from '@sim/logger'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  handleSubagentRouting,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/orchestrator/sse-handlers'
import { parseSSEStream } from '@/lib/copilot/orchestrator/sse-parser'
import {
  normalizeSseEvent,
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/copilot/orchestrator/sse-utils'
import type {
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallSummary,
} from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotStreamCore')

/**
 * Options for the shared stream processing loop.
 */
export interface StreamLoopOptions extends OrchestratorOptions {
  /**
   * Called for each normalized event BEFORE standard handler dispatch.
   * Return true to skip the default handler for this event.
   */
  onBeforeDispatch?: (event: SSEEvent, context: StreamingContext) => boolean | undefined
}

/**
 * Create a fresh StreamingContext.
 */
export function createStreamingContext(overrides?: Partial<StreamingContext>): StreamingContext {
  return {
    chatId: undefined,
    conversationId: undefined,
    messageId: crypto.randomUUID(),
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    currentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentToolCallId: undefined,
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    ...overrides,
  }
}

/**
 * Run the SSE stream processing loop.
 *
 * Handles: fetch -> parse -> normalize -> dedupe -> subagent routing -> handler dispatch.
 * Callers provide the fetch URL/options and can intercept events via onBeforeDispatch.
 */
export async function runStreamLoop(
  fetchUrl: string,
  fetchOptions: RequestInit,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: StreamLoopOptions
): Promise<void> {
  const { timeout = ORCHESTRATION_TIMEOUT_MS, abortSignal } = options

  const response = await fetch(fetchUrl, {
    ...fetchOptions,
    signal: abortSignal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Copilot backend error (${response.status}): ${errorText || response.statusText}`
    )
  }

  if (!response.body) {
    throw new Error('Copilot backend response missing body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let eventCount = 0

  logger.info('[STREAM] SSE stream connected, starting event loop', {
    timeout,
    hasAbortSignal: !!abortSignal,
  })

  const timeoutId = setTimeout(() => {
    logger.warn('[STREAM] Timeout fired, cancelling reader', { timeout, eventCount })
    context.errors.push('Request timed out')
    context.streamComplete = true
    reader.cancel().catch(() => {})
  }, timeout)

  try {
    for await (const event of parseSSEStream(reader, decoder, abortSignal)) {
      eventCount++

      if (abortSignal?.aborted) {
        logger.warn('[STREAM] AbortSignal aborted, breaking', { eventCount })
        context.wasAborted = true
        break
      }

      const normalizedEvent = normalizeSseEvent(event)

      logger.info('[STREAM] Event received', {
        eventNum: eventCount,
        type: normalizedEvent.type,
        toolCallId: normalizedEvent.toolCallId,
        toolName: normalizedEvent.toolName,
        hasSubagent: !!normalizedEvent.subagent,
      })

      // Skip duplicate tool events.
      const shouldSkipToolCall = shouldSkipToolCallEvent(normalizedEvent)
      const shouldSkipToolResult = shouldSkipToolResultEvent(normalizedEvent)

      if (shouldSkipToolCall || shouldSkipToolResult) {
        logger.info('[STREAM] Skipping duplicate event', {
          type: normalizedEvent.type,
          toolCallId: normalizedEvent.toolCallId,
          skipToolCall: shouldSkipToolCall,
          skipToolResult: shouldSkipToolResult,
        })
      }

      if (!shouldSkipToolCall && !shouldSkipToolResult) {
        try {
          await options.onEvent?.(normalizedEvent)
        } catch (error) {
          logger.warn('Failed to forward SSE event', {
            type: normalizedEvent.type,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Let the caller intercept before standard dispatch.
      if (options.onBeforeDispatch?.(normalizedEvent, context)) {
        if (context.streamComplete) break
        continue
      }

      // Standard subagent start/end handling.
      if (normalizedEvent.type === 'subagent_start') {
        const eventData = normalizedEvent.data as Record<string, unknown> | undefined
        const toolCallId = eventData?.tool_call_id as string | undefined
        if (toolCallId) {
          context.subAgentParentToolCallId = toolCallId
          context.subAgentContent[toolCallId] = ''
          context.subAgentToolCalls[toolCallId] = []
        }
        continue
      }

      if (normalizedEvent.type === 'subagent_end') {
        context.subAgentParentToolCallId = undefined
        continue
      }

      // Subagent event routing.
      if (handleSubagentRouting(normalizedEvent, context)) {
        const handler = subAgentHandlers[normalizedEvent.type]
        if (handler) {
          await handler(normalizedEvent, context, execContext, options)
        }
        if (context.streamComplete) break
        continue
      }

      // Main event handler dispatch.
      const handler = sseHandlers[normalizedEvent.type]
      if (handler) {
        logger.info('[STREAM] Dispatching to handler', { type: normalizedEvent.type, toolCallId: normalizedEvent.toolCallId })
        await handler(normalizedEvent, context, execContext, options)
        logger.info('[STREAM] Handler returned', { type: normalizedEvent.type, toolCallId: normalizedEvent.toolCallId, streamComplete: context.streamComplete })
      } else {
        logger.info('[STREAM] No handler for event type', { type: normalizedEvent.type })
      }
      if (context.streamComplete) {
        logger.info('[STREAM] Stream marked complete, breaking', { eventCount, errors: context.errors })
        break
      }
    }
    logger.info('[STREAM] Event loop ended', { eventCount, streamComplete: context.streamComplete, wasAborted: context.wasAborted, errors: context.errors })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Build a ToolCallSummary array from the streaming context.
 */
export function buildToolCallSummaries(context: StreamingContext): ToolCallSummary[] {
  return Array.from(context.toolCalls.values()).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status,
    params: toolCall.params,
    result: toolCall.result?.output,
    error: toolCall.error,
    durationMs:
      toolCall.endTime && toolCall.startTime ? toolCall.endTime - toolCall.startTime : undefined,
  }))
}
