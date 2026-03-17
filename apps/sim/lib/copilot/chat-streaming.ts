import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
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
      await setStreamMeta(streamId, { status: 'active', userId })
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

      try {
        await orchestrateCopilotStream(requestPayload, {
          ...orchestrateOptions,
          abortSignal: abortController.signal,
          onEvent: async (event) => {
            await pushEvent(event)
          },
        })

        await eventWriter.close()
        await setStreamMeta(streamId, { status: 'complete', userId })
      } catch (error) {
        if (abortController.signal.aborted) {
          logger.info(`[${requestId}] Stream aborted by explicit stop`)
          await eventWriter.close().catch(() => {})
          await setStreamMeta(streamId, { status: 'complete', userId })
          return
        }
        if (clientDisconnected) {
          logger.info(`[${requestId}] Stream ended after client disconnect`)
          await eventWriter.close().catch(() => {})
          await setStreamMeta(streamId, { status: 'complete', userId })
          return
        }
        logger.error(`[${requestId}] Orchestration error:`, error)
        await eventWriter.close()
        await setStreamMeta(streamId, {
          status: 'error',
          userId,
          error: error instanceof Error ? error.message : 'Stream error',
        })
        await pushEvent({
          type: 'error',
          data: {
            displayMessage: 'An unexpected error occurred while processing the response.',
          },
        })
      } finally {
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
