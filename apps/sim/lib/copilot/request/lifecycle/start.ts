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
import { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { finalizeStream } from '@/lib/copilot/request/lifecycle/finalize'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'
import { type CopilotLifecycleOutcome, startCopilotOtelRoot } from '@/lib/copilot/request/otel'
import {
  cleanupAbortMarker,
  clearFilePreviewSessions,
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
            outcome = abortController.signal.aborted
              ? RequestTraceV1Outcome.cancelled
              : result.success
                ? RequestTraceV1Outcome.success
                : RequestTraceV1Outcome.error
            await finalizeStream(
              result,
              publisher,
              runId,
              abortController.signal.aborted,
              requestId
            )
          } catch (error) {
            outcome = abortController.signal.aborted
              ? RequestTraceV1Outcome.cancelled
              : RequestTraceV1Outcome.error
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
            await finalizeStream(
              syntheticResult,
              publisher,
              runId,
              abortController.signal.aborted,
              requestId
            )
          } finally {
            collector.endSpan(
              requestSpan,
              outcome === RequestTraceV1Outcome.success
                ? 'ok'
                : outcome === RequestTraceV1Outcome.cancelled
                  ? 'cancelled'
                  : 'error'
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
