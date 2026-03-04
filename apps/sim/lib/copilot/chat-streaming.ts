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
import { env } from '@/lib/core/config/env'

const logger = createLogger('CopilotChatStreaming')

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
  conversationHistory: unknown[]
  message: string
  titleModel: string
  titleProvider?: string
  requestId: string
  orchestrateOptions: Omit<OrchestrateStreamOptions, 'onEvent'>
}

export function createSSEStream(params: StreamingOrchestrationParams): ReadableStream {
  const {
    requestPayload,
    userId,
    streamId,
    chatId,
    currentChat,
    conversationHistory,
    message,
    titleModel,
    titleProvider,
    requestId,
    orchestrateOptions,
  } = params

  let eventWriter: ReturnType<typeof createStreamEventWriter> | null = null
  let clientDisconnected = false

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

      if (chatId && !currentChat?.title && conversationHistory.length === 0) {
        requestChatTitle({ message, model: titleModel, provider: titleProvider })
          .then(async (title) => {
            if (title) {
              await db.update(copilotChats).set({ title }).where(eq(copilotChats.id, chatId!))
              await pushEvent({ type: 'title_updated', title })
            }
          })
          .catch((error) => {
            logger.error(`[${requestId}] Title generation failed:`, error)
          })
      }

      try {
        await orchestrateCopilotStream(requestPayload, {
          ...orchestrateOptions,
          onEvent: async (event) => {
            await pushEvent(event)
          },
        })

        await eventWriter.close()
        await setStreamMeta(streamId, { status: 'complete', userId })
      } catch (error) {
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
        controller.close()
      }
    },
    async cancel() {
      clientDisconnected = true
      if (eventWriter) {
        await eventWriter.flush()
      }
    },
  })
}

export const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Content-Encoding': 'none',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const
