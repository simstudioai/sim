import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { createRunSegment } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
import { finalizeStream } from '@/lib/copilot/request/lifecycle/finalize'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'
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
  } = params

  const abortController = new AbortController()
  registerActiveStream(streamId, abortController)

  const publisher = new StreamWriter({ streamId, chatId, requestId })

  const collector = new TraceCollector()

  return new ReadableStream({
    async start(controller) {
      publisher.attach(controller)

      const requestSpan = collector.startSpan('Mothership Request', 'request', {
        streamId,
        chatId,
        runId,
      })
      let outcome: 'success' | 'error' | 'cancelled' = 'error'
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
            error: toError(error).message,
          })
        })
      }

      const abortPoller = startAbortPoller(streamId, abortController, { requestId })
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
      })

      try {
        const result = await runCopilotLifecycle(requestPayload, {
          ...orchestrateOptions,
          executionId,
          runId,
          trace: collector,
          simRequestId: requestId,
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
        await finalizeStream(result, publisher, runId, abortController.signal.aborted, requestId)
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
            error: toError(error).message,
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
          outcome: outcome as 'success' | 'error' | 'cancelled',
          simRequestId: requestId,
          streamId,
          chatId,
          runId,
          executionId,
          usage: lifecycleResult?.usage,
          cost: lifecycleResult?.cost,
        })
        reportTrace(trace).catch(() => {})
      }
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
  } = params
  if (!chatId || currentChat?.title || !isNewChat) return

  requestChatTitle({ message, model: titleModel, provider: titleProvider })
    .then(async (title) => {
      if (!title) return
      await db.update(copilotChats).set({ title }).where(eq(copilotChats.id, chatId))
      await publisher.publish({
        type: MothershipStreamV1EventType.session,
        payload: { kind: MothershipStreamV1SessionKind.title, title },
      })
      if (workspaceId) {
        taskPubSub?.publishStatusChanged({ workspaceId, chatId, type: 'renamed' })
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
}): Promise<string | null> {
  const { message, model, provider } = params
  if (!message || !model) return null

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/generate-chat-title`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, model, ...(provider ? { provider } : {}) }),
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
