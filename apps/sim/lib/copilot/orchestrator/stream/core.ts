import { createLogger } from '@sim/logger'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isPaid } from '@/lib/billing/plan-helpers'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  handleSubagentRouting,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/orchestrator/sse/handlers'
import { parseSSEStream } from '@/lib/copilot/orchestrator/sse/parser'
import {
  normalizeSseEvent,
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/copilot/orchestrator/sse/utils'
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
    messageId: crypto.randomUUID(),
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    currentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentToolCallId: undefined,
    subAgentParentStack: [],
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

    if (response.status === 402) {
      let action = 'upgrade_plan'
      let message = "You've reached your usage limit. Please upgrade your plan to continue."
      try {
        const sub = await getHighestPrioritySubscription(execContext.userId)
        if (sub && isPaid(sub.plan)) {
          action = 'increase_limit'
          message =
            "You've reached your usage limit for this billing period. Please increase your usage limit to continue."
        }
      } catch {
        // Fall back to upgrade_plan if we can't determine the plan
      }

      const upgradePayload = JSON.stringify({
        reason: 'usage_limit',
        action,
        message,
      })
      const syntheticContent = `<usage_upgrade>${upgradePayload}</usage_upgrade>`

      const syntheticEvents: SSEEvent[] = [
        { type: 'content', data: syntheticContent as unknown as Record<string, unknown> },
        { type: 'done', data: {} },
      ]
      for (const event of syntheticEvents) {
        try {
          await options.onEvent?.(event)
        } catch {
          // best-effort forwarding
        }

        const handler = sseHandlers[event.type]
        if (handler) {
          await handler(event, context, execContext, options)
        }
        if (context.streamComplete) break
      }
      return
    }

    throw new Error(
      `Copilot backend error (${response.status}): ${errorText || response.statusText}`
    )
  }

  if (!response.body) {
    throw new Error('Copilot backend response missing body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  const timeoutId = setTimeout(() => {
    context.errors.push('Request timed out')
    context.streamComplete = true
    reader.cancel().catch(() => {})
  }, timeout)

  try {
    for await (const event of parseSSEStream(reader, decoder, abortSignal)) {
      if (abortSignal?.aborted) {
        context.wasAborted = true
        break
      }

      const normalizedEvent = normalizeSseEvent(event)

      // Skip duplicate tool events — both forwarding AND handler dispatch.
      const shouldSkipToolCall = shouldSkipToolCallEvent(normalizedEvent)
      const shouldSkipToolResult = shouldSkipToolResultEvent(normalizedEvent)

      if (shouldSkipToolCall || shouldSkipToolResult) {
        continue
      }

      try {
        await options.onEvent?.(normalizedEvent)
      } catch (error) {
        logger.warn('Failed to forward SSE event', {
          type: normalizedEvent.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // Let the caller intercept before standard dispatch.
      if (options.onBeforeDispatch?.(normalizedEvent, context)) {
        if (context.streamComplete) break
        continue
      }

      // Standard subagent start/end handling (stack-based for nested agents).
      if (normalizedEvent.type === 'subagent_start') {
        const eventData = normalizedEvent.data as Record<string, unknown> | undefined
        const toolCallId = eventData?.tool_call_id as string | undefined
        const subagentName = normalizedEvent.subagent || (eventData?.agent as string | undefined)
        if (toolCallId) {
          context.subAgentParentStack.push(toolCallId)
          context.subAgentParentToolCallId = toolCallId
          context.subAgentContent[toolCallId] = ''
          context.subAgentToolCalls[toolCallId] = []
        }
        if (subagentName) {
          context.contentBlocks.push({
            type: 'subagent',
            content: subagentName,
            timestamp: Date.now(),
          })
        }
        continue
      }

      if (normalizedEvent.type === 'subagent_end') {
        if (context.subAgentParentStack.length > 0) {
          context.subAgentParentStack.pop()
        } else {
          logger.warn('subagent_end without matching subagent_start')
        }
        context.subAgentParentToolCallId =
          context.subAgentParentStack.length > 0
            ? context.subAgentParentStack[context.subAgentParentStack.length - 1]
            : undefined
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
        await handler(normalizedEvent, context, execContext, options)
      }
      if (context.streamComplete) break
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Build a ToolCallSummary array from the streaming context.
 */
export function buildToolCallSummaries(context: StreamingContext): ToolCallSummary[] {
  return Array.from(context.toolCalls.values()).map((toolCall) => {
    let status = toolCall.status
    if (toolCall.result && toolCall.result.success !== undefined) {
      status = toolCall.result.success ? 'success' : 'error'
    } else if (status === 'pending' || status === 'executing') {
      status = toolCall.error ? 'error' : 'success'
    }
    return {
      id: toolCall.id,
      name: toolCall.name,
      status,
      params: toolCall.params,
      result: toolCall.result?.output,
      error: toolCall.error,
      durationMs:
        toolCall.endTime && toolCall.startTime ? toolCall.endTime - toolCall.startTime : undefined,
    }
  })
}
