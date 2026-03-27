import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { createRunSegment, updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { appendCopilotLogContext } from '@/lib/copilot/logging'
import type { OrchestrateStreamOptions } from '@/lib/copilot/orchestrator'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import {
  createStreamEventWriter,
  getStreamMeta,
  resetStreamBuffer,
  setStreamMeta,
} from '@/lib/copilot/orchestrator/stream/buffer'
import { taskPubSub } from '@/lib/copilot/task-events'
import { env } from '@/lib/core/config/env'
import { acquireLock, getRedisClient, releaseLock } from '@/lib/core/config/redis'
import { SSE_HEADERS } from '@/lib/core/utils/sse'

const logger = createLogger('CopilotChatStreaming')
const CHAT_STREAM_LOCK_TTL_SECONDS = 2 * 60 * 60
const STREAM_ABORT_TTL_SECONDS = 10 * 60
const STREAM_ABORT_POLL_MS = 1000

interface ActiveStreamEntry {
  abortController: AbortController
  userStopController: AbortController
}

const activeStreams = new Map<string, ActiveStreamEntry>()

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

function getChatStreamLockKey(chatId: string): string {
  return `copilot:chat-stream-lock:${chatId}`
}

function getStreamAbortKey(streamId: string): string {
  return `copilot:stream-abort:${streamId}`
}

/**
 * Wait for any in-flight stream on `chatId` to settle without force-aborting it.
 * Returns true when no stream is active (or it settles in time), false on timeout.
 */
export async function waitForPendingChatStream(
  chatId: string,
  timeoutMs = 5_000,
  expectedStreamId?: string
): Promise<boolean> {
  const redis = getRedisClient()
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const entry = pendingChatStreams.get(chatId)
    const localPending = !!entry && (!expectedStreamId || entry.streamId === expectedStreamId)

    if (redis) {
      try {
        const ownerStreamId = await redis.get(getChatStreamLockKey(chatId))
        const lockReleased =
          !ownerStreamId || (expectedStreamId !== undefined && ownerStreamId !== expectedStreamId)
        if (!localPending && lockReleased) {
          return true
        }
      } catch (error) {
        logger.warn('Failed to check distributed chat stream lock while waiting', {
          chatId,
          expectedStreamId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } else if (!localPending) {
      return true
    }

    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

export async function releasePendingChatStream(chatId: string, streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    await releaseLock(getChatStreamLockKey(chatId), streamId).catch(() => false)
  }
  resolvePendingChatStream(chatId, streamId)
}

export async function acquirePendingChatStream(
  chatId: string,
  streamId: string,
  timeoutMs = 5_000
): Promise<boolean> {
  const redis = getRedisClient()
  if (redis) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const acquired = await acquireLock(
          getChatStreamLockKey(chatId),
          streamId,
          CHAT_STREAM_LOCK_TTL_SECONDS
        )
        if (acquired) {
          registerPendingChatStream(chatId, streamId)
          return true
        }
        if (!pendingChatStreams.has(chatId)) {
          const ownerStreamId = await redis.get(getChatStreamLockKey(chatId))
          if (ownerStreamId) {
            const ownerMeta = await getStreamMeta(ownerStreamId)
            const ownerTerminal =
              ownerMeta?.status === 'complete' ||
              ownerMeta?.status === 'error' ||
              ownerMeta?.status === 'cancelled'
            if (ownerTerminal) {
              await releaseLock(getChatStreamLockKey(chatId), ownerStreamId).catch(() => false)
              continue
            }
          }
        }
      } catch (error) {
        logger.warn('Distributed chat stream lock failed; retrying distributed coordination', {
          chatId,
          streamId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  for (;;) {
    const existing = pendingChatStreams.get(chatId)
    if (!existing) {
      registerPendingChatStream(chatId, streamId)
      return true
    }

    const settled = await Promise.race([
      existing.promise.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs)),
    ])
    if (!settled) return false
  }
}

export async function abortActiveStream(streamId: string): Promise<boolean> {
  const redis = getRedisClient()
  let published = false
  if (redis) {
    try {
      await redis.set(getStreamAbortKey(streamId), '1', 'EX', STREAM_ABORT_TTL_SECONDS)
      published = true
    } catch (error) {
      logger.warn('Failed to publish distributed stream abort', {
        streamId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const entry = activeStreams.get(streamId)
  if (!entry) return published
  entry.userStopController.abort()
  entry.abortController.abort()
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
  messageId?: string
}): Promise<string | null> {
  const { message, model, provider, messageId } = params
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
      logger.warn(
        appendCopilotLogContext('Failed to generate chat title via copilot backend', { messageId }),
        {
          status: response.status,
          error: payload,
        }
      )
      return null
    }

    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    return title || null
  } catch (error) {
    logger.error(appendCopilotLogContext('Error generating chat title', { messageId }), error)
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
  pendingChatStreamAlreadyRegistered?: boolean
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
    pendingChatStreamAlreadyRegistered = false,
  } = params
  const messageId =
    typeof requestPayload.messageId === 'string' ? requestPayload.messageId : streamId

  let eventWriter: ReturnType<typeof createStreamEventWriter> | null = null
  let clientDisconnected = false
  const abortController = new AbortController()
  const userStopController = new AbortController()
  const clientDisconnectedController = new AbortController()
  activeStreams.set(streamId, { abortController, userStopController })

  if (chatId && !pendingChatStreamAlreadyRegistered) {
    registerPendingChatStream(chatId, streamId)
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const markClientDisconnected = (reason: string) => {
        if (clientDisconnected) return
        clientDisconnected = true
        if (!clientDisconnectedController.signal.aborted) {
          clientDisconnectedController.abort()
        }
        logger.info(
          appendCopilotLogContext('Client disconnected from live SSE stream', {
            requestId,
            messageId,
          }),
          {
            streamId,
            runId,
            reason,
          }
        )
      }

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
          logger.warn(
            appendCopilotLogContext('Failed to create copilot run segment', {
              requestId,
              messageId,
            }),
            {
              error: error instanceof Error ? error.message : String(error),
            }
          )
        })
      }
      eventWriter = createStreamEventWriter(streamId)

      let localSeq = 0
      let abortPoller: ReturnType<typeof setInterval> | null = null

      const redis = getRedisClient()
      if (redis) {
        abortPoller = setInterval(() => {
          void (async () => {
            try {
              const shouldAbort = await redis.get(getStreamAbortKey(streamId))
              if (shouldAbort && !abortController.signal.aborted) {
                userStopController.abort()
                abortController.abort()
                await redis.del(getStreamAbortKey(streamId))
              }
            } catch (error) {
              logger.warn(
                appendCopilotLogContext('Failed to poll distributed stream abort', {
                  requestId,
                  messageId,
                }),
                {
                  streamId,
                  error: error instanceof Error ? error.message : String(error),
                }
              )
            }
          })()
        }, STREAM_ABORT_POLL_MS)
      }

      const pushEvent = async (event: Record<string, any>) => {
        if (!eventWriter) return

        const eventId = ++localSeq

        try {
          await eventWriter.write(event)
          if (FLUSH_EVENT_TYPES.has(event.type)) {
            await eventWriter.flush()
          }
        } catch (error) {
          logger.error(
            appendCopilotLogContext('Failed to persist stream event', { requestId, messageId }),
            {
              eventType: event.type,
              eventId,
              error: error instanceof Error ? error.message : String(error),
            }
          )
          // Keep the live SSE stream going even if durable buffering hiccups.
        }

        try {
          if (!clientDisconnected) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ ...event, eventId, streamId })}\n\n`)
            )
          }
        } catch {
          markClientDisconnected('enqueue_failed')
        }
      }

      const pushEventBestEffort = async (event: Record<string, any>) => {
        try {
          await pushEvent(event)
        } catch (error) {
          logger.error(appendCopilotLogContext('Failed to push event', { requestId, messageId }), {
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (chatId) {
        await pushEvent({ type: 'chat_id', chatId })
      }

      if (chatId && !currentChat?.title && isNewChat) {
        requestChatTitle({ message, model: titleModel, provider: titleProvider, messageId })
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
            logger.error(
              appendCopilotLogContext('Title generation failed', { requestId, messageId }),
              error
            )
          })
      }

      const keepaliveInterval = setInterval(() => {
        if (clientDisconnected) return
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          markClientDisconnected('keepalive_failed')
        }
      }, 15_000)

      try {
        const result = await orchestrateCopilotStream(requestPayload, {
          ...orchestrateOptions,
          executionId,
          runId,
          abortSignal: abortController.signal,
          userStopSignal: userStopController.signal,
          clientDisconnectedSignal: clientDisconnectedController.signal,
          onEvent: async (event) => {
            await pushEvent(event)
          },
        })

        if (abortController.signal.aborted) {
          logger.error(
            appendCopilotLogContext('Stream aborted by explicit stop', { requestId, messageId })
          )
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
            logger.error(
              appendCopilotLogContext('Stream failed after client disconnect', {
                requestId,
                messageId,
              }),
              {
                error: errorMessage,
              }
            )
          }

          logger.error(
            appendCopilotLogContext('Orchestration returned failure', { requestId, messageId }),
            {
              error: errorMessage,
            }
          )
          await pushEventBestEffort({
            type: 'error',
            error: errorMessage,
            data: {
              displayMessage: errorMessage,
            },
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
        if (clientDisconnected) {
          logger.info(
            appendCopilotLogContext('Orchestration completed after client disconnect', {
              requestId,
              messageId,
            }),
            {
              streamId,
              runId,
            }
          )
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          logger.error(
            appendCopilotLogContext('Stream aborted by explicit stop', { requestId, messageId })
          )
          await eventWriter.close().catch(() => {})
          await setStreamMeta(streamId, { status: 'cancelled', userId, executionId, runId })
          await updateRunStatus(runId, 'cancelled', { completedAt: new Date() }).catch(() => {})
          return
        }
        if (clientDisconnected) {
          logger.error(
            appendCopilotLogContext('Stream errored after client disconnect', {
              requestId,
              messageId,
            }),
            {
              error: error instanceof Error ? error.message : 'Stream error',
            }
          )
        }
        logger.error(
          appendCopilotLogContext('Orchestration error', { requestId, messageId }),
          error
        )
        const errorMessage = error instanceof Error ? error.message : 'Stream error'
        await pushEventBestEffort({
          type: 'error',
          error: errorMessage,
          data: {
            displayMessage: 'An unexpected error occurred while processing the response.',
          },
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
      } finally {
        logger.info(appendCopilotLogContext('Closing live SSE stream', { requestId, messageId }), {
          streamId,
          runId,
          clientDisconnected,
          aborted: abortController.signal.aborted,
        })
        clearInterval(keepaliveInterval)
        if (abortPoller) {
          clearInterval(abortPoller)
        }
        activeStreams.delete(streamId)
        if (chatId) {
          if (redis) {
            await releaseLock(getChatStreamLockKey(chatId), streamId).catch(() => false)
          }
          resolvePendingChatStream(chatId, streamId)
        }
        if (redis) {
          await redis.del(getStreamAbortKey(streamId)).catch(() => {})
        }
        try {
          controller.close()
        } catch {
          // Controller already closed from cancel() — safe to ignore
        }
      }
    },
    cancel() {
      logger.info(
        appendCopilotLogContext('ReadableStream cancel received from client', {
          requestId,
          messageId,
        }),
        {
          streamId,
          runId,
        }
      )
      if (!clientDisconnected) {
        clientDisconnected = true
        if (!clientDisconnectedController.signal.aborted) {
          clientDisconnectedController.abort()
        }
      }
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
