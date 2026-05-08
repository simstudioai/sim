import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { type NextRequest, NextResponse } from 'next/server'
import { tableEventStreamContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { readTableEventsSince, type TableEventEntry } from '@/lib/table/events'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableEventStreamAPI')

const POLL_INTERVAL_MS = 500
const HEARTBEAT_INTERVAL_MS = 15_000
const MAX_STREAM_DURATION_MS = 4 * 60 * 60 * 1000 // 4 hours; client reconnects past this

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId]/events/stream?from=<lastEventId>
 *
 *  SSE stream of cell-state transitions. Replay-on-reconnect via `from`.
 *  Pruning (buffer cap exceeded or TTL expired) sends a `pruned` event and
 *  closes; the client responds with a full row-query refetch and reconnects
 *  from the new earliest. */
export const GET = withRouteHandler(async (req: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()
  const parsed = await parseRequest(tableEventStreamContract, req, context)
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { from: fromEventId } = parsed.data.query

  const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const access = await checkAccess(tableId, auth.userId, 'read')
  if (!access.ok) return accessError(access, requestId, tableId)

  logger.info(`[${requestId}] Table event stream opened`, { tableId, fromEventId })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastEventId = fromEventId
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

      const sendEvents = (events: TableEventEntry[]) => {
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
        // Initial replay from buffer.
        const initial = await readTableEventsSince(tableId, lastEventId)
        if (initial.status === 'pruned') {
          sendPrunedAndClose(initial.earliestEventId)
          return
        }
        if (initial.status === 'unavailable') {
          throw new Error(`Table event buffer unavailable: ${initial.error}`)
        }
        sendEvents(initial.events)

        // Stream loop — poll the buffer and forward new events. Workflow
        // execution stream uses the same shape; pub/sub wakeups are an
        // optimization we can add later if 500ms polling becomes a problem.
        while (!closed && Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS)
          if (closed) return

          const result = await readTableEventsSince(tableId, lastEventId)
          if (result.status === 'pruned') {
            sendPrunedAndClose(result.earliestEventId)
            return
          }
          if (result.status === 'unavailable') {
            throw new Error(`Table event buffer unavailable: ${result.error}`)
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
        logger.error(`[${requestId}] Table event stream error`, {
          tableId,
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
      logger.info(`[${requestId}] Client disconnected from table event stream`, { tableId })
    },
  })

  return new NextResponse(stream, {
    headers: { ...SSE_HEADERS, 'X-Table-Id': tableId },
  })
})
