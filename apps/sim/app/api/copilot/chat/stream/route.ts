import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@sim/logger'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import {
  getStreamMeta,
  readStreamEvents,
  type StreamMeta,
} from '@/lib/copilot/orchestrator/stream-buffer'

const logger = createLogger('CopilotChatStreamAPI')
const POLL_INTERVAL_MS = 250
const MAX_STREAM_MS = 10 * 60 * 1000

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

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  const meta = (await getStreamMeta(streamId)) as StreamMeta | null
  logger.info('[Resume] Stream lookup', {
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
    const filteredEvents = toEventId
      ? events.filter((e) => e.eventId <= toEventId)
      : events
    logger.info('[Resume] Batch response', {
      streamId,
      fromEventId,
      toEventId,
      eventCount: filteredEvents.length,
    })
    return NextResponse.json({
      success: true,
      events: filteredEvents,
      status: meta.status,
    })
  }

  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let lastEventId = Number.isFinite(fromEventId) ? fromEventId : 0

      const flushEvents = async () => {
        const events = await readStreamEvents(streamId, lastEventId)
        if (events.length > 0) {
          logger.info('[Resume] Flushing events', {
            streamId,
            fromEventId: lastEventId,
            eventCount: events.length,
          })
        }
        for (const entry of events) {
          lastEventId = entry.eventId
          const payload = {
            ...entry.event,
            eventId: entry.eventId,
            streamId: entry.streamId,
          }
          controller.enqueue(encodeEvent(payload))
        }
      }

      try {
        await flushEvents()

        while (Date.now() - startTime < MAX_STREAM_MS) {
          const currentMeta = await getStreamMeta(streamId)
          if (!currentMeta) break

          await flushEvents()

          if (currentMeta.status === 'complete' || currentMeta.status === 'error') {
            break
          }

          if (request.signal.aborted) {
            break
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        }
      } catch (error) {
        logger.warn('Stream replay failed', {
          streamId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

