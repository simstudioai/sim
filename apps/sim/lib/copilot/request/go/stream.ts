import { createLogger } from '@sim/logger'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { parseSSEStream } from '@/lib/copilot/request/go/parser'
import {
  handleSubagentRouting,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/request/handlers'
import { eventToStreamEvent, isEventRecord } from '@/lib/copilot/request/session'
import { shouldSkipToolCallEvent, shouldSkipToolResultEvent } from '@/lib/copilot/request/sse-utils'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'

const logger = createLogger('CopilotGoStream')

export class CopilotBackendError extends Error {
  status?: number
  body?: string

  constructor(message: string, options?: { status?: number; body?: string }) {
    super(message)
    this.name = 'CopilotBackendError'
    this.status = options?.status
    this.body = options?.body
  }
}

export class BillingLimitError extends Error {
  constructor(public readonly userId: string) {
    super('Usage limit reached')
    this.name = 'BillingLimitError'
  }
}

/**
 * Options for the shared stream processing loop.
 */
export interface StreamLoopOptions extends OrchestratorOptions {
  /**
   * Called for each normalized event BEFORE standard handler dispatch.
   * Return true to skip the default handler for this event.
   */
  onBeforeDispatch?: (event: StreamEvent, context: StreamingContext) => boolean | undefined
}

/**
 * Run the SSE stream processing loop against the Go backend.
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
      throw new BillingLimitError(execContext.userId)
    }

    throw new CopilotBackendError(
      `Copilot backend error (${response.status}): ${errorText || response.statusText}`,
      { status: response.status, body: errorText || response.statusText }
    )
  }

  if (!response.body) {
    throw new CopilotBackendError('Copilot backend response missing body')
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
        await reader.cancel().catch(() => {})
        break
      }

      if (!isEventRecord(event)) {
        logger.warn('Received non-contract stream event on shared path; dropping event')
        continue
      }
      const streamEvent = eventToStreamEvent(event)
      if (event.trace?.requestId) {
        context.requestId = event.trace.requestId
      }

      const shouldSkipToolCall = shouldSkipToolCallEvent(streamEvent)
      const shouldSkipToolResult = shouldSkipToolResultEvent(streamEvent)

      if (shouldSkipToolCall || shouldSkipToolResult) {
        continue
      }

      try {
        await options.onEvent?.(streamEvent)
      } catch (error) {
        logger.warn('Failed to forward stream event', {
          type: streamEvent.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (options.onBeforeDispatch?.(streamEvent, context)) {
        if (context.streamComplete) break
        continue
      }

      if (
        streamEvent.type === MothershipStreamV1EventType.span &&
        streamEvent.payload.kind === MothershipStreamV1SpanPayloadKind.subagent
      ) {
        const spanData =
          streamEvent.payload.data &&
          typeof streamEvent.payload.data === 'object' &&
          !Array.isArray(streamEvent.payload.data)
            ? (streamEvent.payload.data as Record<string, unknown>)
            : undefined
        const toolCallId =
          (streamEvent.payload.parentToolCallId as string | undefined) ||
          (spanData?.tool_call_id as string | undefined)
        const subagentName = streamEvent.payload.agent as string | undefined
        const spanEvent = streamEvent.payload.event as string | undefined
        if (spanEvent === MothershipStreamV1SpanLifecycleEvent.start) {
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
        if (spanEvent === MothershipStreamV1SpanLifecycleEvent.end) {
          if (context.subAgentParentStack.length > 0) {
            context.subAgentParentStack.pop()
          } else {
            logger.warn('subagent end without matching start')
          }
          context.subAgentParentToolCallId =
            context.subAgentParentStack.length > 0
              ? context.subAgentParentStack[context.subAgentParentStack.length - 1]
              : undefined
          continue
        }
      }

      if (handleSubagentRouting(streamEvent, context)) {
        const handler = subAgentHandlers[streamEvent.type]
        if (handler) {
          await handler(streamEvent, context, execContext, options)
        }
        if (context.streamComplete) break
        continue
      }

      const handler = sseHandlers[streamEvent.type]
      if (handler) {
        await handler(streamEvent, context, execContext, options)
      }
      if (context.streamComplete) break
    }
  } finally {
    if (abortSignal?.aborted) {
      context.wasAborted = true
      await reader.cancel().catch(() => {})
    }
    clearTimeout(timeoutId)
  }
}
