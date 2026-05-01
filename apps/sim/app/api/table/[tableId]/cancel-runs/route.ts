import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { cancelTableRunsContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cancelWorkflowGroupRuns } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableCancelRunsAPI')

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/cancel-runs
 *
 * Cancels in-flight and pending workflow-column runs for this table. Scopes:
 * `all` (every cell) or `row` (every cell for `rowId`).
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(cancelTableRunsContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const { workspaceId, scope, rowId } = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    const { table } = result

    if (table.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const cancelled = await cancelWorkflowGroupRuns(tableId, scope === 'row' ? rowId : undefined)
    logger.info(
      `[${requestId}] cancel-runs: tableId=${tableId} scope=${scope}${
        rowId ? ` rowId=${rowId}` : ''
      } cancelled=${cancelled}`
    )

    return NextResponse.json({ success: true, data: { cancelled } })
  } catch (error) {
    logger.error(`[${requestId}] cancel-runs failed:`, error)
    return NextResponse.json({ error: 'Failed to cancel runs' }, { status: 500 })
  }
})
