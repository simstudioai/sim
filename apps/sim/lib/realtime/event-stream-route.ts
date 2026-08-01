import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { NextResponse } from 'next/server'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import type { EventLogEntry, EventLogReadResult } from '@/lib/realtime/event-log'

const logger = createLogger('EventStreamRoute')

const POLL_INTERVAL_MS = 500
const HEARTBEAT_INTERVAL_MS = 15_000
/** Defensive ceiling; the client reconnects (resuming from lastEventId) past this. */
const MAX_STREAM_DURATION_MS = 4 * 60 * 60 * 1000

export interface EventStreamResponseOptions<E extends EventLogEntry> {
  requestId: string
  /** The durable-log stream id (e.g. a tableId). */
  streamId: string
  /** Replay cursor from `?from=`; `undefined` tails from the latest event id. */
  fromEventId: number | undefined
  getLatestEventId: (streamId: string) => Promise<number>
  readEventsSince: (streamId: string, afterEventId: number) => Promise<EventLogReadResult<E>>
  /** Extra response headers (e.g. `{ 'X-Table-Id': id }`). */
  extraHeaders?: Record<string, string>
  /** Short label for logs (e.g. 'table'). */
  label: string
}

/**
 * Shared SSE stream for any durable event log (`@/lib/realtime/event-log`). Handles
 * replay-on-reconnect (`?from=`), tail-from-latest on a fresh mount, chunked poll +
 * forward, heartbeats, graceful `pruned`/`rotate` close, and error propagation.
 *
 * Auth and contract parsing stay in the route (they are domain-specific); this
 * owns only the streaming mechanics, so every durable-log surface streams
 * identically. The poll loop mirrors the execution stream; pub/sub wakeups are an
 * optimization that can replace the 500ms poll later without changing this shape.
 */
export function createEventStreamResponse<E extends EventLogEntry>(
  options: EventStreamResponseOptions<E>
): NextResponse {
  const { requestId, streamId, fromEventId, getLatestEventId, readEventsSince, label } = options

  logger.info(`[${requestId}] ${label} event stream opened`, { streamId, fromEventId })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastEventId = fromEventId ?? 0
      const deadline = Date.now() + MAX_STREAM_DURATION_MS
      let nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS

      const enqueue = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }

      const sendEvents = (events: E[]) => {
        for (const entry of events) {
          if (closed) return
          enqueue(`data: ${JSON.stringify(entry)}\n\n`)
          lastEventId = entry.eventId
        }
      }

      const sendPrunedAndClose = (earliestEventId: number | undefined) => {
        enqueue(
          `event: pruned\ndata: ${JSON.stringify({ earliestEventId: earliestEventId ?? null })}\n\n`
        )
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {}
        }
      }

      const sendHeartbeat = () => {
        // SSE comment line — keeps proxies (ALB default 60s idle) from closing
        // the connection during quiet periods.
        enqueue(`: ping ${Date.now()}\n\n`)
      }

      try {
        // No replay cursor → tail from the latest event id. Resolved inside the
        // try so a Redis failure errors the stream (client reconnects with
        // backoff) rather than silently replaying the whole buffer.
        if (fromEventId === undefined) {
          lastEventId = await getLatestEventId(streamId)
        }

        const initial = await readEventsSince(streamId, lastEventId)
        if (initial.status === 'pruned') {
          sendPrunedAndClose(initial.earliestEventId)
          return
        }
        if (initial.status === 'unavailable') {
          throw new Error(`${label} event buffer unavailable: ${initial.error}`)
        }
        sendEvents(initial.events)

        while (!closed && Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS)
          if (closed) return

          const result = await readEventsSince(streamId, lastEventId)
          if (result.status === 'pruned') {
            sendPrunedAndClose(result.earliestEventId)
            return
          }
          if (result.status === 'unavailable') {
            throw new Error(`${label} event buffer unavailable: ${result.error}`)
          }
          if (result.events.length > 0) {
            sendEvents(result.events)
          }

          if (Date.now() >= nextHeartbeatAt) {
            sendHeartbeat()
            nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS
          }
        }

        // Reached the defensive duration ceiling — close cleanly so the client
        // reconnects with the latest lastEventId.
        if (!closed) {
          enqueue(`event: rotate\ndata: {}\n\n`)
          closed = true
          try {
            controller.close()
          } catch {}
        }
      } catch (error) {
        logger.error(`[${requestId}] ${label} event stream error`, {
          streamId,
          error: toError(error).message,
        })
        if (!closed) {
          try {
            controller.error(error)
          } catch {}
        }
      }
    },
    cancel() {
      closed = true
      logger.info(`[${requestId}] Client disconnected from ${label} event stream`, { streamId })
    },
  })

  return new NextResponse(stream, {
    headers: { ...SSE_HEADERS, ...(options.extraHeaders ?? {}) },
  })
}
