import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { createRunSegment, updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import type { OrchestrateStreamOptions } from '@/lib/copilot/orchestrator'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import {
  createStreamEventWriter,
  resetStreamBuffer,
  setStreamMeta,
} from '@/lib/copilot/orchestrator/stream/buffer'
import { taskPubSub } from '@/lib/copilot/task-events'
import { env } from '@/lib/core/config/env'
import { SSE_HEADERS } from '@/lib/core/utils/sse'

const logger = createLogger('CopilotChatStreaming')

// Registry of in-flight Sim→Go streams so the explicit abort endpoint can
// reach them. Keyed by streamId, cleaned up when the stream completes.
const activeStreams = new Map<string, AbortController>()

// Tracks in-flight streams by chatId so that a subsequent request for the
// same chat can force-abort the previous stream and wait for it to settle
// before forwarding to Go.
const pendingChatStreams = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; streamId: string }
>()

function registerPendingChatStream(chatId: string, streamId: string): void {
  if (pendingChatStreams.has(chatId)) {
    logger.warn(`registerPendingChatStream: overwriting existing entry for chatId ${chatId}`)
  }
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  pendingChatStreams.set(chatId, { promise, resolve, streamId })
}

function resolvePendingChatStream(chatId: string, streamId: string): void {
  const entry = pendingChatStreams.get(chatId)
  if (entry && entry.streamId === streamId) {
    entry.resolve()
    pendingChatStreams.delete(chatId)
  }
}

/**
 * Abort any in-flight stream on `chatId` and wait for it to fully settle
 * (including onComplete and Go-side persistence). Returns immediately if
 * no stream is active. Gives up after `timeoutMs`.
 */
export async function waitForPendingChatStream(chatId: string, timeoutMs = 5_000): Promise<void> {
  const entry = pendingChatStreams.get(chatId)
  if (!entry) return

  // Force-abort the previous stream so we don't passively wait for it to
  // finish naturally (which could take tens of seconds for a subagent).
  abortActiveStream(entry.streamId)

  await Promise.race([entry.promise, new Promise<void>((r) => setTimeout(r, timeoutMs))])
}

export function abortActiveStream(streamId: string): boolean {
  const controller = activeStreams.get(streamId)
  if (!controller) return false
  controller.abort()
  activeStreams.delete(streamId)
  return true
}

const FLUSH_EVENT_TYPES = new Set([
  'tool_call',
  'tool_result',
  'tool_error',
  'subagent_end',
  'structured_result',
  'subagent_result',
  'done',
  'error',
])

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

  let eventWriter: ReturnType<typeof createStreamEventWriter> | null = null
  let clientDisconnected = false
  const abortController = new AbortController()
  activeStreams.set(streamId, abortController)

  if (chatId) {
    registerPendingChatStream(chatId, streamId)
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      await resetStreamBuffer(streamId)
      await setStreamMeta(streamId, { status: 'active', userId, executionId, runId })
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
      eventWriter = createStreamEventWriter(streamId)

      let localSeq = 0

      const pushEvent = async (event: Record<string, any>) => {
        if (!eventWriter) return

        const eventId = ++localSeq

        // Enqueue to client stream FIRST for minimal latency.
        // Redis persistence happens after so the client never waits on I/O.
        try {
          if (!clientDisconnected) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ ...event, eventId, streamId })}\n\n`)
            )
          }
        } catch {
          clientDisconnected = true
        }

        try {
          await eventWriter.write(event)
          if (FLUSH_EVENT_TYPES.has(event.type)) {
            await eventWriter.flush()
          }
        } catch {
          if (clientDisconnected) {
            await eventWriter.flush().catch(() => {})
          }
        }
      }

      if (chatId) {
        await pushEvent({ type: 'chat_id', chatId })
      }

      if (chatId && !currentChat?.title && isNewChat) {
        requestChatTitle({ message, model: titleModel, provider: titleProvider })
          .then(async (title) => {
            if (title) {
              await db.update(copilotChats).set({ title }).where(eq(copilotChats.id, chatId!))
              await pushEvent({ type: 'title_updated', title })
              if (workspaceId) {
                taskPubSub?.publishStatusChanged({ workspaceId, chatId: chatId!, type: 'renamed' })
              }
            }
          })
          .catch((error) => {
            logger.error(`[${requestId}] Title generation failed:`, error)
          })
      }

      const keepaliveInterval = setInterval(() => {
        if (clientDisconnected) return
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clientDisconnected = true
        }
      }, 15_000)

      try {
        const result = await orchestrateCopilotStream(requestPayload, {
          ...orchestrateOptions,
          executionId,
          runId,
          abortSignal: abortController.signal,
          onEvent: async (event) => {
            await pushEvent(event)
          },
        })

        if (abortController.signal.aborted) {
          logger.info(`[${requestId}] Stream aborted by explicit stop`)
          await eventWriter.close().catch(() => {})
          await setStreamMeta(streamId, { status: 'cancelled', userId, executionId, runId })
          await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
          return
        }

        if (!result.success) {
          const errorMessage =
            result.error ||
            result.errors?.[0] ||
            'An unexpected error occurred while processing the response.'

          if (clientDisconnected) {
            logger.info(`[${requestId}] Stream ended after client disconnect`)
            await eventWriter.close().catch(() => {})
            await setStreamMeta(streamId, { status: 'cancelled', userId, executionId, runId })
            await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
            return
          }

          logger.error(`[${requestId}] Orchestration returned failure`, {
            error: errorMessage,
          })
          await eventWriter.close()
          await setStreamMeta(streamId, {
            status: 'error',
            userId,
            executionId,
            runId,
            error: errorMessage,
          })
          await updateRunStatus(runId, 'error', {
            completedAt: new Date(),
            error: errorMessage,
          }).catch(() => {})
          return
        }

        await eventWriter.close()
        await setStreamMeta(streamId, { status: 'complete', userId, executionId, runId })
        await updateRunStatus(runId, 'complete', { completedAt: new Date() }).catch(() => {})
      } catch (error) {
        if (abortController.signal.aborted) {
          logger.info(`[${requestId}] Stream aborted by explicit stop`)
          await eventWriter.close().catch(() => {})
          await setStreamMeta(streamId, { status: 'cancelled', userId, executionId, runId })
          await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
          return
        }
        if (clientDisconnected) {
          logger.info(`[${requestId}] Stream ended after client disconnect`)
          await eventWriter.close().catch(() => {})
          await setStreamMeta(streamId, { status: 'cancelled', userId, executionId, runId })
          await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
          return
        }
        logger.error(`[${requestId}] Orchestration error:`, error)
        await eventWriter.close()
        await setStreamMeta(streamId, {
          status: 'error',
          userId,
          executionId,
          runId,
          error: error instanceof Error ? error.message : 'Stream error',
        })
        await updateRunStatus(runId, 'error', {
          completedAt: new Date(),
          error: error instanceof Error ? error.message : 'Stream error',
        }).catch(() => {})
        await pushEvent({
          type: 'error',
          data: {
            displayMessage: 'An unexpected error occurred while processing the response.',
          },
        })
      } finally {
        clearInterval(keepaliveInterval)
        activeStreams.delete(streamId)
        if (chatId) {
          resolvePendingChatStream(chatId, streamId)
        }
        try {
          controller.close()
        } catch {
          // Controller already closed from cancel() — safe to ignore
        }
      }
    },
    cancel() {
      clientDisconnected = true
      if (eventWriter) {
        eventWriter.flush().catch(() => {})
      }
    },
  })
}

export const SSE_RESPONSE_HEADERS = {
  ...SSE_HEADERS,
  'Content-Encoding': 'none',
} as const
