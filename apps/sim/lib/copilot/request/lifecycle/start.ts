import { type Context, context as otelContextApi } from '@opentelemetry/api'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { createRunSegment } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  RequestTraceV1Outcome,
  RequestTraceV1SpanStatus,
} from '@/lib/copilot/generated/request-trace-v1'
import {
  CopilotRequestCancelReason,
  type CopilotRequestCancelReasonValue,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/copilot/generated/trace-events-v1'
import { finalizeStream } from '@/lib/copilot/request/lifecycle/finalize'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'
import { type CopilotLifecycleOutcome, startCopilotOtelRoot } from '@/lib/copilot/request/otel'
import {
  cleanupAbortMarker,
  clearFilePreviewSessions,
  isExplicitStopReason,
  registerActiveStream,
  releasePendingChatStream,
  resetBuffer,
  StreamWriter,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  startAbortPoller,
  unregisterActiveStream,
} from '@/lib/copilot/request/session'
import { SSE_RESPONSE_HEADERS } from '@/lib/copilot/request/session/sse'
import { reportTrace, TraceCollector } from '@/lib/copilot/request/trace'
import { taskPubSub } from '@/lib/copilot/tasks'
import { env } from '@/lib/core/config/env'

export { SSE_RESPONSE_HEADERS }

const logger = createLogger('CopilotChatStreaming')

type CurrentChatSummary = {
  title?: string | null
} | null

export interface StreamingOrchestrationParams {
  requestPayload: Record<string, unknown>
  userId: string
  streamId: string
  executionId: string
  runId: string
  chatId?: string
  currentChat: CurrentChatSummary
  isNewChat: boolean
  message: string
  titleModel: string
  titleProvider?: string
  requestId: string
  workspaceId?: string
  orchestrateOptions: Omit<CopilotLifecycleOptions, 'onEvent'>
  /**
   * Pre-started gen_ai.agent.execute root returned by
   * `startCopilotOtelRoot`. When provided, this stream binds every nested
   * span to that root and calls `finish()` on termination. When omitted,
   * this function starts its own root internally (kept for back-compat
   * with the headless path).
   */
  otelRoot?: ReturnType<typeof startCopilotOtelRoot>
}

export function createSSEStream(params: StreamingOrchestrationParams): ReadableStream {
  const {
    requestPayload,
    userId,
    streamId,
    executionId,
    runId,
    chatId,
    currentChat,
    isNewChat,
    message,
    titleModel,
    titleProvider,
    requestId,
    workspaceId,
    orchestrateOptions,
    otelRoot,
  } = params

  // If the caller (POST handler) already started the gen_ai.agent.execute
  // root so that pre-stream setup work (persistUserMessage, resource
  // loads, etc.) could nest under it, reuse that root and finish it from
  // our terminal code path via the idempotent `finish`. Otherwise start
  // our own so the stream still gets a proper OTel trace.
  const activeOtelRoot =
    otelRoot ??
    startCopilotOtelRoot({
      requestId,
      route: orchestrateOptions.goRoute,
      chatId,
      workflowId: orchestrateOptions.workflowId,
      executionId,
      runId,
      streamId,
      transport: 'stream',
    })

  const abortController = new AbortController()
  registerActiveStream(streamId, abortController)

  const publisher = new StreamWriter({ streamId, chatId, requestId })

  /**
   * Classifies a cancelled outcome into one of the closed-vocabulary
   * `CopilotRequestCancelReason` values, and records the result on the
   * active OTel root span (attribute + event).
   *
   * Classification rules:
   * - `signal.reason` is in the known explicit-stop set (see
   *   `AbortReason.*`) → `ExplicitStop`.
   * - Otherwise, `publisher.clientDisconnected` → `ClientDisconnect`.
   * - Otherwise → `Unknown`, which is a latent bug: the stream aborted
   *   with a reason we don't recognize and the client never dropped.
   *   We log an error with the raw reason and record it on the span so
   *   we can find whichever code path added a new `abort(...)` call
   *   without updating the contract.
   *
   * IMPORTANT: `publisher.clientDisconnected` alone is NOT a reliable
   * discriminator. When the user clicks Stop, `abortActiveStream`
   * fires `abortController.abort(AbortReason.UserStop)`, which closes
   * the SSE stream, which causes the BROWSER to disconnect its SSE
   * reader, which propagates back as `publisher.markDisconnected()`.
   * So on an explicit Stop you observe BOTH the explicit reason AND
   * `clientDisconnected=true`. The reason string is the source of
   * truth for intent; the disconnect flag is only a fallback.
   */
  const recordCancelled = (errorMessage?: string): CopilotRequestCancelReasonValue => {
    const rawReason = abortController.signal.reason
    let cancelReason: CopilotRequestCancelReasonValue
    if (isExplicitStopReason(rawReason)) {
      cancelReason = CopilotRequestCancelReason.ExplicitStop
    } else if (publisher.clientDisconnected) {
      cancelReason = CopilotRequestCancelReason.ClientDisconnect
    } else {
      cancelReason = CopilotRequestCancelReason.Unknown
      const serializedReason =
        rawReason === undefined
          ? 'undefined'
          : rawReason instanceof Error
            ? `${rawReason.name}: ${rawReason.message}`
            : typeof rawReason === 'string'
              ? rawReason
              : (() => {
                  try {
                    return JSON.stringify(rawReason)
                  } catch {
                    return String(rawReason)
                  }
                })()
      // Not user-facing. Signals a contract violation: a code path
      // aborted the stream with a reason that isn't in the known set,
      // and the client didn't disconnect either. Whoever sees this
      // should add the new reason to `AbortReason` / `isExplicitStopReason`
      // (if it's explicit) or extend the classifier.
      logger.error(`[${requestId}] Stream cancelled with unknown abort reason`, {
        streamId,
        chatId,
        reason: serializedReason,
      })
      activeOtelRoot.span.setAttribute(TraceAttr.CopilotAbortUnknownReason, serializedReason)
    }
    activeOtelRoot.span.setAttribute(TraceAttr.CopilotRequestCancelReason, cancelReason)
    activeOtelRoot.span.addEvent(TraceEvent.RequestCancelled, {
      [TraceAttr.CopilotRequestCancelReason]: cancelReason,
      ...(errorMessage ? { [TraceAttr.ErrorMessage]: errorMessage } : {}),
    })
    return cancelReason
  }

  const collector = new TraceCollector()

  return new ReadableStream({
    async start(controller) {
      publisher.attach(controller)

      // Re-enter the root OTel context. Node's AsyncLocalStorage does
      // not survive the Next.js handler -> ReadableStream.start boundary,
      // so nested `withCopilotSpan` / `withDbSpan` calls would otherwise
      // orphan into new traces.
      await otelContextApi.with(activeOtelRoot.context, async () => {
        const otelContext = activeOtelRoot.context
        let rootOutcome: CopilotLifecycleOutcome = RequestTraceV1Outcome.error
        let rootError: unknown
        try {
          const requestSpan = collector.startSpan('Mothership Request', 'request', {
            streamId,
            chatId,
            runId,
          })
          let outcome: CopilotLifecycleOutcome = RequestTraceV1Outcome.error
          let lifecycleResult:
            | {
                usage?: { prompt: number; completion: number }
                cost?: { input: number; output: number; total: number }
              }
            | undefined

          await Promise.all([resetBuffer(streamId), clearFilePreviewSessions(streamId)])

          if (chatId) {
            createRunSegment({
              id: runId,
              executionId,
              chatId,
              userId,
              workflowId: (requestPayload.workflowId as string | undefined) || null,
              workspaceId,
              streamId,
              model: (requestPayload.model as string | undefined) || null,
              provider: (requestPayload.provider as string | undefined) || null,
              requestContext: { requestId },
            }).catch((error) => {
              logger.warn(`[${requestId}] Failed to create copilot run segment`, {
                error: error instanceof Error ? error.message : String(error),
              })
            })
          }

          const abortPoller = startAbortPoller(streamId, abortController, {
            requestId,
          })
          publisher.startKeepalive()

          if (chatId) {
            publisher.publish({
              type: MothershipStreamV1EventType.session,
              payload: {
                kind: MothershipStreamV1SessionKind.chat,
                chatId,
              },
            })
          }

          fireTitleGeneration({
            chatId,
            currentChat,
            isNewChat,
            message,
            titleModel,
            titleProvider,
            workspaceId,
            requestId,
            publisher,
            otelContext,
          })

          try {
            const result = await runCopilotLifecycle(requestPayload, {
              ...orchestrateOptions,
              executionId,
              runId,
              trace: collector,
              simRequestId: requestId,
              otelContext,
              abortSignal: abortController.signal,
              onEvent: async (event) => {
                await publisher.publish(event)
              },
            })

            lifecycleResult = result
            // Outcome classification (priority order):
            //   1. `result.success` → success. The orchestrator
            //      reporting "finished cleanly" wins over any later
            //      signal change. Matters for the narrow race where
            //      the user clicks Stop a beat after the stream
            //      completed.
            //   2. `signal.aborted` (from `abortActiveStream` or the
            //      Redis-marker poller) OR `clientDisconnected` with
            //      a non-success result → cancelled. `recordCancelled`
            //      further refines into explicit_stop / client_disconnect
            //      / unknown via `signal.reason`.
            //   3. Otherwise → error.
            outcome = result.success
              ? RequestTraceV1Outcome.success
              : abortController.signal.aborted || publisher.clientDisconnected
                ? RequestTraceV1Outcome.cancelled
                : RequestTraceV1Outcome.error
            if (outcome === RequestTraceV1Outcome.cancelled) {
              recordCancelled()
            }
            // Pass the resolved outcome — not `signal.aborted` — so
            // `finalizeStream` classifies the same way we did above.
            // A client-disconnect-without-controller-abort still needs
            // to hit `handleAborted` (not `handleError`) so the chat
            // row gets `cancelled` terminal state instead of `error`.
            await finalizeStream(result, publisher, runId, outcome, requestId)
          } catch (error) {
            // Error-path classification: if the abort signal fired or
            // the client disconnected, treat the thrown error as a
            // cancel (same rationale as the try-path above).
            const wasCancelled = abortController.signal.aborted || publisher.clientDisconnected
            outcome = wasCancelled ? RequestTraceV1Outcome.cancelled : RequestTraceV1Outcome.error
            if (outcome === RequestTraceV1Outcome.cancelled) {
              recordCancelled(error instanceof Error ? error.message : String(error))
            }
            if (publisher.clientDisconnected) {
              logger.info(`[${requestId}] Stream errored after client disconnect`, {
                error: error instanceof Error ? error.message : 'Stream error',
              })
            }
            logger.error(`[${requestId}] Unexpected orchestration error:`, error)

            const syntheticResult = {
              success: false as const,
              content: '',
              contentBlocks: [],
              toolCalls: [],
              error: 'An unexpected error occurred while processing the response.',
            }
            await finalizeStream(syntheticResult, publisher, runId, outcome, requestId)
          } finally {
            collector.endSpan(
              requestSpan,
              outcome === RequestTraceV1Outcome.success
                ? RequestTraceV1SpanStatus.ok
                : outcome === RequestTraceV1Outcome.cancelled
                  ? RequestTraceV1SpanStatus.cancelled
                  : RequestTraceV1SpanStatus.error
            )

            clearInterval(abortPoller)
            try {
              await publisher.close()
            } catch (error) {
              logger.warn(`[${requestId}] Failed to flush stream persistence during close`, {
                error: error instanceof Error ? error.message : String(error),
              })
            }
            unregisterActiveStream(streamId)
            if (chatId) {
              await releasePendingChatStream(chatId, streamId)
            }
            await scheduleBufferCleanup(streamId)
            await scheduleFilePreviewSessionCleanup(streamId)
            await cleanupAbortMarker(streamId)

            const trace = collector.build({
              outcome,
              simRequestId: requestId,
              streamId,
              chatId,
              runId,
              executionId,
              // Pass the raw user prompt through so the Go-side trace
              // ingest can stamp it onto the `request_traces.message`
              // column at insert time. Avoids relying on the late
              // `UpdateAnalytics` UPDATE (which silently misses many
              // rows).
              userMessage: message,
              usage: lifecycleResult?.usage,
              cost: lifecycleResult?.cost,
            })
            reportTrace(trace, otelContext).catch(() => {})
            rootOutcome = outcome
            if (lifecycleResult?.usage) {
              activeOtelRoot.span.setAttributes({
                [TraceAttr.GenAiUsageInputTokens]: lifecycleResult.usage.prompt ?? 0,
                [TraceAttr.GenAiUsageOutputTokens]: lifecycleResult.usage.completion ?? 0,
              })
            }
            if (lifecycleResult?.cost) {
              activeOtelRoot.span.setAttributes({
                [TraceAttr.BillingCostInputUsd]: lifecycleResult.cost.input ?? 0,
                [TraceAttr.BillingCostOutputUsd]: lifecycleResult.cost.output ?? 0,
                [TraceAttr.BillingCostTotalUsd]: lifecycleResult.cost.total ?? 0,
              })
            }
          }
        } catch (error) {
          rootOutcome = RequestTraceV1Outcome.error
          rootError = error
          throw error
        } finally {
          // `finish` is idempotent, so it's safe whether the POST
          // handler started the root (and may also call finish on an
          // error path before the stream ran) or we did.
          activeOtelRoot.finish(rootOutcome, rootError)
        }
      })
    },
    cancel() {
      // The browser's SSE reader closed. Flip `clientDisconnected` so
      // in-flight `publisher.publish` calls silently no-op (prevents
      // enqueueing on a closed controller).
      //
      // Intentionally does NOT fire the AbortController here. The
      // abort controller is reserved for actual "abort this request"
      // semantics (driven by `abortActiveStream()` on an explicit Stop
      // or the Redis-marker poller for cross-node Stops). Firing it
      // on browser disconnect means a successful stream that loses
      // its reader at the last moment would get retroactively
      // classified as aborted — which skips persisting the assistant
      // message (see trace 707f2614 where the whole response
      // disappeared after completion).
      //
      // Trade-off: on a true tab close, the orchestrator keeps reading
      // events from Go until Go's stream ends, with `publish` no-op'ing
      // each one. That's wasted LLM work but it's safe — the message
      // gets persisted and the next chat reload shows it. An
      // explicit Stop short-circuits this path cleanly via the
      // /chat/abort handler, which DOES fire the AbortController.
      publisher.markDisconnected()
    },
  })
}

// ---------------------------------------------------------------------------
// Title generation (fire-and-forget side effect)
// ---------------------------------------------------------------------------

function fireTitleGeneration(params: {
  chatId?: string
  currentChat: CurrentChatSummary
  isNewChat: boolean
  message: string
  titleModel: string
  titleProvider?: string
  workspaceId?: string
  requestId: string
  publisher: StreamWriter
  otelContext?: Context
}): void {
  const {
    chatId,
    currentChat,
    isNewChat,
    message,
    titleModel,
    titleProvider,
    workspaceId,
    requestId,
    publisher,
    otelContext,
  } = params
  if (!chatId || currentChat?.title || !isNewChat) return

  requestChatTitle({
    message,
    model: titleModel,
    provider: titleProvider,
    otelContext,
  })
    .then(async (title) => {
      if (!title) return
      await db.update(copilotChats).set({ title }).where(eq(copilotChats.id, chatId))
      await publisher.publish({
        type: MothershipStreamV1EventType.session,
        payload: { kind: MothershipStreamV1SessionKind.title, title },
      })
      if (workspaceId) {
        taskPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'renamed',
        })
      }
    })
    .catch((error) => {
      logger.error(`[${requestId}] Title generation failed:`, error)
    })
}

// ---------------------------------------------------------------------------
// Chat title helper
// ---------------------------------------------------------------------------

export async function requestChatTitle(params: {
  message: string
  model: string
  provider?: string
  otelContext?: Context
}): Promise<string | null> {
  const { message, model, provider, otelContext } = params
  if (!message || !model) return null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const { fetchGo } = await import('@/lib/copilot/request/go/fetch')
    const response = await fetchGo(`${SIM_AGENT_API_URL}/api/generate-chat-title`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        model,
        ...(provider ? { provider } : {}),
      }),
      otelContext,
      spanName: 'sim → go /api/generate-chat-title',
      operation: 'generate_chat_title',
      attributes: {
        [TraceAttr.GenAiRequestModel]: model,
        ...(provider ? { [TraceAttr.GenAiSystem]: provider } : {}),
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.warn('Failed to generate chat title via copilot backend', {
        status: response.status,
        error: payload,
      })
      return null
    }

    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    return title || null
  } catch (error) {
    logger.error('Error generating chat title:', error)
    return null
  }
}
