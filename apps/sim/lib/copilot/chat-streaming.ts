import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { createRunSegment, updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  abortActiveStream,
  cleanupAbortMarker,
  registerActiveStream,
  resetOutbox,
  SSE_RESPONSE_HEADERS,
  StreamPublisher,
  startAbortPoller,
  unregisterActiveStream,
} from '@/lib/copilot/mothership-stream'
import type { OrchestrateStreamOptions } from '@/lib/copilot/orchestrator'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { taskPubSub } from '@/lib/copilot/task-events'
import { env } from '@/lib/core/config/env'

const logger = createLogger('CopilotChatStreaming')

export { abortActiveStream, SSE_RESPONSE_HEADERS }

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

export interface StreamingOrchestrationParams {
  requestPayload: Record<string, unknown>
  userId: string
  streamId: string
  executionId: string
  runId: string
  chatId?: string
  currentChat: any
  isNewChat: boolean
  message: string
  titleModel: string
  titleProvider?: string
  requestId: string
  workspaceId?: string
  orchestrateOptions: Omit<OrchestrateStreamOptions, 'onEvent'>
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

  const publisher = new StreamPublisher({
    streamId,
    chatId,
    requestId,
  })

  return new ReadableStream({
    async start(controller) {
      publisher.attach(controller)

      await resetOutbox(streamId)
      if (chatId) {
        await createRunSegment({
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

      const abortPoller = startAbortPoller(streamId, abortController, { requestId })
      publisher.startKeepalive()

      if (chatId) {
        await publisher.publish({
          type: MothershipStreamV1EventType.session,
          payload: {
            kind: MothershipStreamV1SessionKind.chat,
            chatId,
          },
        })
      }

      if (chatId && !currentChat?.title && isNewChat) {
        requestChatTitle({ message, model: titleModel, provider: titleProvider })
          .then(async (title) => {
            if (title) {
              await db.update(copilotChats).set({ title }).where(eq(copilotChats.id, chatId!))
              await publisher.publish({
                type: MothershipStreamV1EventType.session,
                payload: {
                  kind: MothershipStreamV1SessionKind.title,
                  title,
                },
              })
              if (workspaceId) {
                taskPubSub?.publishStatusChanged({ workspaceId, chatId: chatId!, type: 'renamed' })
              }
            }
          })
          .catch((error) => {
            logger.error(`[${requestId}] Title generation failed:`, error)
          })
      }

      try {
        const result = await orchestrateCopilotStream(requestPayload, {
          ...orchestrateOptions,
          executionId,
          runId,
          abortSignal: abortController.signal,
          onEvent: async (event) => {
            await publisher.publish(event)
          },
        })

        if (abortController.signal.aborted) {
          logger.info(`[${requestId}] Stream aborted by explicit stop`)
          await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
          if (!publisher.sawComplete) {
            await publisher.publish({
              type: MothershipStreamV1EventType.complete,
              payload: { status: MothershipStreamV1CompletionStatus.cancelled },
            })
          }
          return
        }

        if (!result.success) {
          const errorMessage =
            result.error ||
            result.errors?.[0] ||
            'An unexpected error occurred while processing the response.'

          if (publisher.clientDisconnected) {
            logger.info(`[${requestId}] Stream failed after client disconnect`, {
              error: errorMessage,
            })
          }

          logger.error(`[${requestId}] Orchestration returned failure`, {
            error: errorMessage,
          })
          await publisher.publish({
            type: MothershipStreamV1EventType.error,
            payload: {
              message: errorMessage,
              error: errorMessage,
              data: { displayMessage: errorMessage },
            },
          })
          if (!publisher.sawComplete) {
            await publisher.publish({
              type: MothershipStreamV1EventType.complete,
              payload: { status: MothershipStreamV1CompletionStatus.error },
            })
          }
          await updateRunStatus(runId, 'error', {
            completedAt: new Date(),
            error: errorMessage,
          }).catch(() => {})
          return
        }

        await updateRunStatus(runId, 'complete', { completedAt: new Date() }).catch(() => {})
        if (!publisher.sawComplete) {
          await publisher.publish({
            type: MothershipStreamV1EventType.complete,
            payload: { status: MothershipStreamV1CompletionStatus.complete },
          })
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          logger.info(`[${requestId}] Stream aborted by explicit stop`)
          await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
          if (!publisher.sawComplete) {
            await publisher.publish({
              type: MothershipStreamV1EventType.complete,
              payload: { status: MothershipStreamV1CompletionStatus.cancelled },
            })
          }
          return
        }
        if (publisher.clientDisconnected) {
          logger.info(`[${requestId}] Stream errored after client disconnect`, {
            error: error instanceof Error ? error.message : 'Stream error',
          })
        }
        logger.error(`[${requestId}] Orchestration error:`, error)
        const errorMessage = error instanceof Error ? error.message : 'Stream error'
        await publisher.publish({
          type: MothershipStreamV1EventType.error,
          payload: {
            message: errorMessage,
            error: errorMessage,
            data: {
              displayMessage: 'An unexpected error occurred while processing the response.',
            },
          },
        })
        if (!publisher.sawComplete) {
          await publisher.publish({
            type: MothershipStreamV1EventType.complete,
            payload: { status: MothershipStreamV1CompletionStatus.error },
          })
        }
        await updateRunStatus(runId, 'error', {
          completedAt: new Date(),
          error: errorMessage,
        }).catch(() => {})
      } finally {
        clearInterval(abortPoller)
        publisher.close()
        unregisterActiveStream(streamId)
        await cleanupAbortMarker(streamId)
      }
    },
    cancel() {
      publisher.markDisconnected()
    },
  })
}
