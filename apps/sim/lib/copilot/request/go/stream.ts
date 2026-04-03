import { createLogger } from '@sim/logger'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { processSSEStream } from '@/lib/copilot/request/go/parser'
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

// Pre-resolve text handlers at module level to avoid map lookups in the hot path.
const textHandler = sseHandlers[MothershipStreamV1EventType.text]
const subagentTextHandler = subAgentHandlers[MothershipStreamV1EventType.text]

/**
 * Run the SSE stream processing loop against the Go backend.
 *
 * Handles: fetch -> parse -> normalize -> dedupe -> subagent routing -> handler dispatch.
 * Callers provide the fetch URL/options and can intercept events via onBeforeDispatch.
 *
 * Optimised hot path: text events (the most frequent) bypass tool-call dedup
 * checks and are dispatched synchronously without any await, eliminating ~4
 * microtask yields per text event vs the previous async-generator + await chain.
 */
export async function runStreamLoop(
  fetchUrl: string,
  fetchOptions: RequestInit,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: StreamLoopOptions
): Promise<void> {
  const { timeout = ORCHESTRATION_TIMEOUT_MS, abortSignal } = options

  const fetchSpan = context.trace.startSpan(
    `HTTP Request → ${new URL(fetchUrl).pathname}`,
    'sim.http.fetch',
    { url: fetchUrl }
  )
  const response = await fetch(fetchUrl, {
    ...fetchOptions,
    signal: abortSignal,
  })

  if (!response.ok) {
    context.trace.endSpan(fetchSpan, 'error')
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
    context.trace.endSpan(fetchSpan, 'error')
    throw new CopilotBackendError('Copilot backend response missing body')
  }

  context.trace.endSpan(fetchSpan)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  const timeoutId = setTimeout(() => {
    context.errors.push('Request timed out')
    context.streamComplete = true
    reader.cancel().catch(() => {})
  }, timeout)

  try {
    await processSSEStream(reader, decoder, abortSignal, (raw) => {
      // --- Abort gate (sync check, no await) ---
      if (abortSignal?.aborted) {
        context.wasAborted = true
        return true
      }

      if (!isEventRecord(raw)) {
        logger.warn('Received non-contract stream event on shared path; dropping event')
        return
      }

      const streamEvent = eventToStreamEvent(raw)
      if (raw.trace?.requestId) {
        context.requestId = raw.trace.requestId
        context.trace.setGoTraceId(raw.trace.requestId)
      }

      // ---------------------------------------------------------------
      // FAST PATH — text events
      //
      // Text is the most frequent event type. We skip two things that
      // can never match for text events:
      //   • shouldSkipToolCallEvent  (early-exits for type !== 'tool')
      //   • shouldSkipToolResultEvent (early-exits for type !== 'tool')
      //
      // All calls in this path are synchronous: onEvent (publish) returns
      // void, and both textHandler / subagentTextHandler return void.
      // Eliminating the awaits saves 2 microtask yields per text event
      // (on top of the 2 saved by replacing the async generator).
      // ---------------------------------------------------------------
      if (streamEvent.type === MothershipStreamV1EventType.text) {
        try {
          options.onEvent?.(streamEvent)
        } catch (error) {
          logger.warn('Failed to forward stream event', {
            type: streamEvent.type,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        if (options.onBeforeDispatch?.(streamEvent, context)) {
          return context.streamComplete || undefined
        }

        if (handleSubagentRouting(streamEvent, context)) {
          subagentTextHandler(streamEvent, context, execContext, options)
        } else {
          textHandler(streamEvent, context, execContext, options)
        }
        return context.streamComplete || undefined
      }

      // ---------------------------------------------------------------
      // STANDARD PATH — all other event types
      // ---------------------------------------------------------------
      if (shouldSkipToolCallEvent(streamEvent) || shouldSkipToolResultEvent(streamEvent)) {
        return
      }

      // onEvent (publish) is synchronous — no await needed.
      try {
        options.onEvent?.(streamEvent)
      } catch (error) {
        logger.warn('Failed to forward stream event', {
          type: streamEvent.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (options.onBeforeDispatch?.(streamEvent, context)) {
        return context.streamComplete || undefined
      }

      // --- Subagent span lifecycle ---
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
        const isPendingPause = spanData?.pending === true
        if (spanEvent === MothershipStreamV1SpanLifecycleEvent.start) {
          const lastParent = context.subAgentParentStack[context.subAgentParentStack.length - 1]
          const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
          if (toolCallId) {
            if (lastParent !== toolCallId) {
              context.subAgentParentStack.push(toolCallId)
            }
            context.subAgentParentToolCallId = toolCallId
            context.subAgentContent[toolCallId] ??= ''
            context.subAgentToolCalls[toolCallId] ??= []
          }
          if (
            subagentName &&
            !(
              lastParent === toolCallId &&
              lastBlock?.type === 'subagent' &&
              lastBlock.content === subagentName
            )
          ) {
            context.contentBlocks.push({
              type: 'subagent',
              content: subagentName,
              timestamp: Date.now(),
            })
          }
          return
        }
        if (spanEvent === MothershipStreamV1SpanLifecycleEvent.end) {
          if (isPendingPause) {
            return
          }
          if (context.subAgentParentStack.length > 0) {
            context.subAgentParentStack.pop()
          } else {
            logger.warn('subagent end without matching start')
          }
          context.subAgentParentToolCallId =
            context.subAgentParentStack.length > 0
              ? context.subAgentParentStack[context.subAgentParentStack.length - 1]
              : undefined
          return
        }
      }

      // --- Subagent-scoped event dispatch ---
      if (handleSubagentRouting(streamEvent, context)) {
        const handler = subAgentHandlers[streamEvent.type]
        if (handler) {
          // All current subagent handlers (text, tool, span) resolve
          // synchronously or fire-and-forget their async work internally.
          // Calling without await saves 1 microtask yield per event.
          handler(streamEvent, context, execContext, options)
        }
        return context.streamComplete || undefined
      }

      // --- Main handler dispatch ---
      const handler = sseHandlers[streamEvent.type]
      if (handler) {
        // session, complete, error, run, span handlers are synchronous.
        // tool handler is async but resolves immediately (fire-and-forget
        // internal dispatch). Calling without await saves 1 microtask yield.
        handler(streamEvent, context, execContext, options)
      }
      return context.streamComplete || undefined
    })
  } finally {
    if (abortSignal?.aborted) {
      context.wasAborted = true
      await reader.cancel().catch(() => {})
    }
    clearTimeout(timeoutId)
  }
}
