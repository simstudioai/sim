import { type NextRequest, NextResponse } from 'next/server'
import { tableEventStreamContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createEventStreamResponse } from '@/lib/realtime/event-stream-route'
import { getLatestTableEventId, readTableEventsSince } from '@/lib/table/events'
import { accessError, checkAccess } from '@/app/api/table/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId]/events/stream?from=<lastEventId>
 *
 *  SSE stream of cell-state transitions over the shared durable event log. Auth
 *  and access are checked here; the replay/tail/poll/heartbeat/prune mechanics
 *  come from `createEventStreamResponse`. */
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

  return createEventStreamResponse({
    requestId,
    label: 'table',
    streamId: tableId,
    fromEventId,
    getLatestEventId: getLatestTableEventId,
    readEventsSince: readTableEventsSince,
    extraHeaders: { 'X-Table-Id': tableId },
  })
})
