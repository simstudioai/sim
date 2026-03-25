import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { appendCopilotLogContext } from '@/lib/copilot/logging'
import {
  getStreamMeta,
  readStreamEvents,
  type StreamMeta,
} from '@/lib/copilot/orchestrator/stream/buffer'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import { SSE_HEADERS } from '@/lib/core/utils/sse'

export const maxDuration = 3600

const logger = createLogger('CopilotChatStreamAPI')
const POLL_INTERVAL_MS = 250
const MAX_STREAM_MS = 60 * 60 * 1000

function encodeEvent(event: Record<string, any>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

export async function GET(request: NextRequest) {
  const { userId: authenticatedUserId, isAuthenticated } =
    await authenticateCopilotRequestSessionOnly()

  if (!isAuthenticated || !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const streamId = url.searchParams.get('streamId') || ''
  const fromParam = url.searchParams.get('from') || '0'
  const fromEventId = Number(fromParam || 0)
  // If batch=true, return buffered events as JSON instead of SSE
  const batchMode = url.searchParams.get('batch') === 'true'
  const toParam = url.searchParams.get('to')
  const toEventId = toParam ? Number(toParam) : undefined

  logger.error(
    appendCopilotLogContext('[Resume] Received resume request', {
      messageId: streamId || undefined,
    }),
    {
      streamId: streamId || undefined,
      fromEventId,
      toEventId,
      batchMode,
    }
  )

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  const meta = (await getStreamMeta(streamId)) as StreamMeta | null
  logger.error(appendCopilotLogContext('[Resume] Stream lookup', { messageId: streamId }), {
    streamId,
    fromEventId,
    toEventId,
    batchMode,
    hasMeta: !!meta,
    metaStatus: meta?.status,
  })
  if (!meta) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }
  if (meta.userId && meta.userId !== authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Batch mode: return all buffered events as JSON
  if (batchMode) {
    const events = await readStreamEvents(streamId, fromEventId)
    const filteredEvents = toEventId ? events.filter((e) => e.eventId <= toEventId) : events
    logger.error(appendCopilotLogContext('[Resume] Batch response', { messageId: streamId }), {
      streamId,
      fromEventId,
      toEventId,
      eventCount: filteredEvents.length,
    })
    return NextResponse.json({
      success: true,
      events: filteredEvents,
      status: meta.status,
      executionId: meta.executionId,
      runId: meta.runId,
    })
  }

  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let lastEventId = Number.isFinite(fromEventId) ? fromEventId : 0
      let latestMeta = meta
      let controllerClosed = false

      const closeController = () => {
        if (controllerClosed) return
        controllerClosed = true
        try {
          controller.close()
        } catch {
          // Controller already closed by runtime/client - treat as normal.
        }
      }

      const enqueueEvent = (payload: Record<string, any>) => {
        if (controllerClosed) return false
        try {
          controller.enqueue(encodeEvent(payload))
          return true
        } catch {
          controllerClosed = true
          return false
        }
      }

      const abortListener = () => {
        controllerClosed = true
      }
      request.signal.addEventListener('abort', abortListener, { once: true })

      const flushEvents = async () => {
        const events = await readStreamEvents(streamId, lastEventId)
        if (events.length > 0) {
          logger.error(
            appendCopilotLogContext('[Resume] Flushing events', { messageId: streamId }),
            {
              streamId,
              fromEventId: lastEventId,
              eventCount: events.length,
            }
          )
        }
        for (const entry of events) {
          lastEventId = entry.eventId
          const payload = {
            ...entry.event,
            eventId: entry.eventId,
            streamId: entry.streamId,
            executionId: latestMeta?.executionId,
            runId: latestMeta?.runId,
          }
          if (!enqueueEvent(payload)) {
            break
          }
        }
      }

      try {
        await flushEvents()

        while (!controllerClosed && Date.now() - startTime < MAX_STREAM_MS) {
          const currentMeta = await getStreamMeta(streamId)
          if (!currentMeta) break
          latestMeta = currentMeta

          await flushEvents()

          if (controllerClosed) {
            break
          }
          if (
            currentMeta.status === 'complete' ||
            currentMeta.status === 'error' ||
            currentMeta.status === 'cancelled'
          ) {
            break
          }

          if (request.signal.aborted) {
            controllerClosed = true
            break
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        }
      } catch (error) {
        if (!controllerClosed && !request.signal.aborted) {
          logger.warn(appendCopilotLogContext('Stream replay failed', { messageId: streamId }), {
            streamId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        request.signal.removeEventListener('abort', abortListener)
        closeController()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
