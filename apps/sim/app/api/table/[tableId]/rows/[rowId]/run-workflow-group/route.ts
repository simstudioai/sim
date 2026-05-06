import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { runRowWorkflowGroupContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { triggerWorkflowGroupRun } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunWorkflowGroupAPI')

interface RouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** POST /api/table/[tableId]/rows/[rowId]/run-workflow-group */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(runRowWorkflowGroupContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId, rowId } = parsed.data.params
    const { workspaceId, groupId } = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { triggered } = await triggerWorkflowGroupRun({
      tableId,
      groupId,
      workspaceId,
      mode: 'all',
      requestId,
      rowIds: [rowId],
    })

    return NextResponse.json({ success: true, data: { triggered } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Row not found') {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Workflow group not found') {
      return NextResponse.json({ error: 'Workflow group not found' }, { status: 404 })
    }
    if (error instanceof Error && error.message === 'Invalid workspace ID') {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    logger.error(`run-workflow-group failed:`, error)
    return NextResponse.json({ error: 'Failed to run workflow group' }, { status: 500 })
  }
})
