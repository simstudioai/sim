import { createLogger } from '@sim/logger'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import { MothershipStreamV1SpanLifecycleEvent } from '@/lib/copilot/generated/mothership-stream-v1'
import {
  buildPreviewContentUpdate,
  createFilePreviewAdapterState,
  decodeJsonStringPrefix,
  extractEditContent,
  processFilePreviewStreamEvent,
} from '@/lib/copilot/request/go/file-preview-adapter'
import { FatalSseEventError, processSSEStream } from '@/lib/copilot/request/go/parser'
import {
  handleSubagentRouting,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/request/handlers'
import {
  eventToStreamEvent,
  isSubagentSpanStreamEvent,
  parsePersistedStreamEventEnvelope,
} from '@/lib/copilot/request/session'
import { shouldSkipToolCallEvent, shouldSkipToolResultEvent } from '@/lib/copilot/request/sse-utils'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'
import { toError } from '@/lib/core/utils/helpers'

const logger = createLogger('CopilotGoStream')

export { buildPreviewContentUpdate, decodeJsonStringPrefix, extractEditContent }

type JsonRecord = Record<string, unknown>

type SubagentSpanData = {
  pending?: boolean
  toolCallId?: string
}

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function parseSubagentSpanData(value: unknown): SubagentSpanData | undefined {
  const data = asJsonRecord(value)
  if (!data) {
    return undefined
  }

  const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : undefined
  const pending = typeof data.pending === 'boolean' ? data.pending : undefined

  return {
    ...(toolCallId ? { toolCallId } : {}),
    ...(pending !== undefined ? { pending } : {}),
  }
}

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
  /**
   * Called when the Go backend's trace ID (go_trace_id) is first received via SSE.
   */
  onGoTraceId?: (goTraceId: string) => void
}

/**
 * Run the SSE stream processing loop against the Go backend.
 *
 * Handles: fetch -> parse -> normalize -> dedupe -> subagent routing -> handler dispatch.
 * Callers provide the fetch URL/options and can intercept events via onBeforeDispatch.
 * Feature-specific normalization runs through dedicated adapters before the raw event is forwarded.
 */
export async function runStreamLoop(
  fetchUrl: string,
  fetchOptions: RequestInit,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: StreamLoopOptions
): Promise<void> {
  const { timeout = ORCHESTRATION_TIMEOUT_MS, abortSignal } = options
  const filePreviewAdapterState = createFilePreviewAdapterState()

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
    await processSSEStream(reader, decoder, abortSignal, async (raw) => {
      if (abortSignal?.aborted) {
        context.wasAborted = true
        return true
      }

      const parsedEvent = parsePersistedStreamEventEnvelope(raw)
      if (!parsedEvent.ok) {
        const detail = [parsedEvent.message, ...(parsedEvent.errors ?? [])]
          .filter(Boolean)
          .join('; ')
        const failureMessage = `Received invalid stream event on shared path: ${detail}`
        context.errors.push(failureMessage)
        logger.error('Received invalid stream event on shared path', {
          reason: parsedEvent.reason,
          message: parsedEvent.message,
          errors: parsedEvent.errors,
        })
        throw new FatalSseEventError(failureMessage)
      }

      const envelope = parsedEvent.event
      const streamEvent = eventToStreamEvent(envelope)
      if (envelope.trace?.requestId) {
        const prev = context.requestId
        context.requestId = envelope.trace.requestId
        context.trace.setGoTraceId(envelope.trace.requestId)
        if (envelope.trace.requestId !== prev) {
          options.onGoTraceId?.(envelope.trace.requestId)
        }
      }

      if (shouldSkipToolCallEvent(streamEvent) || shouldSkipToolResultEvent(streamEvent)) {
        return
      }

      await processFilePreviewStreamEvent({
        streamId: envelope.stream.streamId,
        streamEvent,
        context,
        execContext,
        options,
        state: filePreviewAdapterState,
      })

      try {
        await options.onEvent?.(streamEvent)
      } catch (error) {
        logger.warn('Failed to forward stream event', {
          type: streamEvent.type,
          error: toError(error).message,
        })
      }

      // Yield a macrotask so Node.js flushes the HTTP response buffer to
      // the browser. Microtask yields (await Promise.resolve()) are not
      // enough — the I/O layer needs a full event loop tick to write.
      await new Promise<void>((resolve) => setImmediate(resolve))

      if (options.onBeforeDispatch?.(streamEvent, context)) {
        return context.streamComplete || undefined
      }

      if (isSubagentSpanStreamEvent(streamEvent)) {
        const spanData = parseSubagentSpanData(streamEvent.payload.data)
        const toolCallId = streamEvent.scope?.parentToolCallId || spanData?.toolCallId
        const subagentName = streamEvent.payload.agent
        const spanEvt = streamEvent.payload.event
        const isPendingPause = spanData?.pending === true
        if (spanEvt === MothershipStreamV1SpanLifecycleEvent.start) {
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
        if (spanEvt === MothershipStreamV1SpanLifecycleEvent.end) {
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

      if (handleSubagentRouting(streamEvent, context)) {
        const handler = subAgentHandlers[streamEvent.type]
        if (handler) {
          await handler(streamEvent, context, execContext, options)
        }
        return context.streamComplete || undefined
      }

      const handler = sseHandlers[streamEvent.type]
      if (handler) {
        await handler(streamEvent, context, execContext, options)
      }
      return context.streamComplete || undefined
    })

    if (!context.streamComplete && !abortSignal?.aborted && !context.wasAborted) {
      const streamPath = new URL(fetchUrl).pathname
      const message = `Copilot backend stream ended before a terminal event on ${streamPath}`
      context.errors.push(message)
      logger.error('Copilot backend stream ended before a terminal event', {
        path: streamPath,
        requestId: context.requestId,
        messageId: context.messageId,
      })
      throw new CopilotBackendError(message, { status: 503 })
    }
  } catch (error) {
    if (error instanceof FatalSseEventError && !context.errors.includes(error.message)) {
      context.errors.push(error.message)
    }
    throw error
  } finally {
    if (abortSignal?.aborted) {
      context.wasAborted = true
      await reader.cancel().catch(() => {})
    }
    clearTimeout(timeoutId)
  }
}
