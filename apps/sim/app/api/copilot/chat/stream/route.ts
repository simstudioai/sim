import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import {
  checkForReplayGap,
  encodeSSEEnvelope,
  readEnvelopes,
  SSE_RESPONSE_HEADERS,
} from '@/lib/copilot/mothership-stream'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'

export const maxDuration = 3600

const logger = createLogger('CopilotChatStreamAPI')
const POLL_INTERVAL_MS = 250
const MAX_STREAM_MS = 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const { userId: authenticatedUserId, isAuthenticated } =
    await authenticateCopilotRequestSessionOnly()

  if (!isAuthenticated || !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const streamId = url.searchParams.get('streamId') || ''
  const afterCursor = url.searchParams.get('after') || ''

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  const run = await getLatestRunForStream(streamId, authenticatedUserId).catch(() => null)
  logger.info('[Resume] Stream lookup', {
    streamId,
    afterCursor,
    hasRun: !!run,
    runStatus: run?.status,
  })
  if (!run) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }

  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = afterCursor || '0'
      let controllerClosed = false

      const closeController = () => {
        if (controllerClosed) return
        controllerClosed = true
        try {
          controller.close()
        } catch {
          // Controller already closed by runtime/client
        }
      }

      const enqueueEvent = (payload: unknown) => {
        if (controllerClosed) return false
        try {
          controller.enqueue(encodeSSEEnvelope(payload))
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
        const events = await readEnvelopes(streamId, cursor)
        if (events.length > 0) {
          logger.info('[Resume] Flushing events', {
            streamId,
            afterCursor: cursor,
            eventCount: events.length,
          })
        }
        for (const envelope of events) {
          cursor = envelope.stream.cursor ?? String(envelope.seq)
          if (!enqueueEvent(envelope)) {
            break
          }
        }
      }

      try {
        const gap = await checkForReplayGap(streamId, afterCursor)
        if (gap) {
          for (const envelope of gap.envelopes) {
            enqueueEvent(envelope)
          }
          return
        }

        await flushEvents()

        while (!controllerClosed && Date.now() - startTime < MAX_STREAM_MS) {
          const currentRun = await getLatestRunForStream(streamId, authenticatedUserId).catch(
            () => null
          )
          if (!currentRun) break

          await flushEvents()

          if (controllerClosed) {
            break
          }
          if (
            currentRun.status === 'complete' ||
            currentRun.status === 'error' ||
            currentRun.status === 'cancelled'
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
          logger.warn('Stream replay failed', {
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

  return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
}
