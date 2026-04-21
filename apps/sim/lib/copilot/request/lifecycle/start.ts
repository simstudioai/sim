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
  CopilotTransport,
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
   * Pre-started root; child spans bind to it and `finish()` fires on
   * termination. Omit to let the stream start its own root (headless).
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

  // Reuse caller's root if provided; otherwise start our own.
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
      transport: CopilotTransport.Stream,
    })

  const abortController = new AbortController()
  registerActiveStream(streamId, abortController)

  const publisher = new StreamWriter({ streamId, chatId, requestId })

  // Classify cancel: signal.reason (explicit-stop set) wins, then
  // clientDisconnected, else Unknown (latent contract bug — log it).
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
      // Contract violation: add the new reason to AbortReason /
      // isExplicitStopReason or extend the classifier.
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

      // Re-enter the root OTel context — ALS doesn't survive the
      // Next handler → ReadableStream.start boundary.
      await otelContextApi.with(activeOtelRoot.context, async () => {
        const otelContext = activeOtelRoot.context
        let rootOutcome: CopilotLifecycleOutcome = RequestTraceV1Outcome.error
        let rootError: unknown
        // `cancelReason` must be declared OUTSIDE the outer `try` so
        // it remains in scope for the outer `finally` that calls
        // `activeOtelRoot.finish(rootOutcome, rootError, cancelReason)`.
        // `let` bindings declared inside a `try` block are NOT visible
        // in the paired `finally`; referencing one there raises a
        // TDZ ReferenceError, skipping `finish()`, leaving the root
        // span never-ended, and making Tempo see every child as an
        // orphan under a phantom parent. (Regression landed 2026-04-21.)
        let cancelReason: CopilotRequestCancelReasonValue | undefined
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
              cancelReason = recordCancelled()
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
              cancelReason = recordCancelled(error instanceof Error ? error.message : String(error))
            }
            if (publisher.clientDisconnected) {
              logger.info(`[${requestId}] Stream errored after client disconnect`, {
                error: error instanceof Error ? error.message : 'Stream error',
              })
            }
            // Demote to warn when the throw came from a user-initiated
            // cancel — it isn't an "unexpected" failure then, and the
            // error-level log pollutes alerting on normal Stop presses.
            const logFn = outcome === RequestTraceV1Outcome.cancelled ? logger.warn : logger.error
            logFn.call(logger, `[${requestId}] Orchestration ended with ${outcome}:`, error)

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
            reportTrace(trace, otelContext).catch((err) => {
              logger.warn(`[${requestId}] Failed to report trace`, {
                error: err instanceof Error ? err.message : String(err),
              })
            })
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
          // error path before the stream ran) or we did. The cancel
          // reason (if any) determines whether `cancelled` is an
          // expected outcome (explicit_stop → status OK) or a real
          // error (client_disconnect / unknown → status ERROR).
          //
          // Belt-and-suspenders: if `finish()` itself throws (e.g. an
          // argument in the TDZ, a bad attribute, a regression in
          // status-setting), fall back to `span.end()` directly. A
          // root that never ends leaves every child orphaned in Tempo
          // under a phantom parent; force-ending it keeps the trace
          // shape intact even when the pretty-finalize path is
          // broken. The error is logged so Loki greps surface the
          // regression instead of it silently costing us trace
          // fidelity for hours.
          try {
            activeOtelRoot.finish(rootOutcome, rootError, cancelReason)
          } catch (finishError) {
            logger.error(`[${requestId}] activeOtelRoot.finish threw; force-ending root span`, {
              error: finishError instanceof Error ? finishError.message : String(finishError),
            })
            try {
              activeOtelRoot.span.end()
            } catch {
              // Already ended or an OTel internal failure — nothing
              // more we can do. The export pipe has already had its
              // chance; swallow to avoid masking the original error
              // path.
            }
          }
        }
      })
    },
    cancel() {
      // The browser's SSE reader closed. Flip `clientDisconnected` so
      // in-flight `publisher.publish` calls silently no-op (prevents
      // enqueueing on a closed controller).
      //
      // Browser disconnect is NOT an abort — firing the controller
      // here retroactively reclassifies in-flight successful streams
      // as aborted and skips assistant persistence. Let the
      // orchestrator drain naturally; publish no-ops post-disconnect.
      // Explicit Stop still fires the controller via /chat/abort.
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
