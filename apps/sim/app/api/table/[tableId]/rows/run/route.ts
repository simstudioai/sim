import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { runRowContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runWorkflowRow } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunRowAPI')

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/table/[tableId]/rows/run */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const parsed = await parseRequest(runRowContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const { workspaceId, rowIds } = parsed.data.body
    const access = await checkAccess(tableId, auth.userId, 'write')
    if (!access.ok) return accessError(access, requestId, tableId)

    const { triggered } = await runWorkflowRow({
      tableId,
      workspaceId,
      rowIds,
      requestId,
    })
    return NextResponse.json({ success: true, data: { triggered } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid workspace ID') {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    logger.error(`run-row failed:`, error)
    return NextResponse.json({ error: 'Failed to run rows' }, { status: 500 })
  }
})
