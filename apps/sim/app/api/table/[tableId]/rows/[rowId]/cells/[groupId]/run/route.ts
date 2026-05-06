import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { runCellContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runWorkflowCell } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunCellAPI')

interface RouteParams {
  params: Promise<{ tableId: string; rowId: string; groupId: string }>
}

/** POST /api/table/[tableId]/rows/[rowId]/cells/[groupId]/run */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const parsed = await parseRequest(runCellContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId, rowId, groupId } = parsed.data.params
    const { workspaceId } = parsed.data.body
    const access = await checkAccess(tableId, auth.userId, 'write')
    if (!access.ok) return accessError(access, requestId, tableId)

    const { triggered } = await runWorkflowCell({
      tableId,
      workspaceId,
      rowId,
      groupId,
      requestId,
    })
    return NextResponse.json({ success: true, data: { triggered } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid workspace ID') {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    logger.error(`run-cell failed:`, error)
    return NextResponse.json({ error: 'Failed to run cell' }, { status: 500 })
  }
})
