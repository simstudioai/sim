import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { type ActiveDispatch, listActiveDispatchesContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { countActiveRunCells, listActiveDispatches } from '@/lib/table/dispatcher'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableDispatchesAPI')

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * GET /api/table/[tableId]/dispatches
 *
 * Returns active (`pending` / `dispatching`) dispatches for the table. Drives
 * the client's "about to run" overlay so refresh during a long Run-all keeps
 * the queued indicators on rows the dispatcher hasn't reached yet.
 */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(listActiveDispatchesContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const rows = await listActiveDispatches(tableId)
    const running = await countActiveRunCells(tableId, rows)
    const dispatches: ActiveDispatch[] = rows.map((r) => ({
      id: r.id,
      status: r.status as 'pending' | 'dispatching',
      mode: r.mode,
      isManualRun: r.isManualRun,
      cursor: r.cursor,
      scope: r.scope,
      ...(r.limit ? { limit: r.limit } : {}),
    }))

    return NextResponse.json({
      success: true,
      data: {
        dispatches,
        runningCellCount: running.total,
        runningByRowId: running.byRowId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] list-dispatches failed:`, error)
    return NextResponse.json({ error: 'Failed to list active dispatches' }, { status: 500 })
  }
})
