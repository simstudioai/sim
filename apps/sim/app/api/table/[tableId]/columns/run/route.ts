import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { runColumnContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunColumnAPI')

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/table/[tableId]/columns/run */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const parsed = await parseRequest(runColumnContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const { workspaceId, groupIds, runMode, rowIds } = parsed.data.body
    const access = await checkAccess(tableId, auth.userId, 'write')
    if (!access.ok) return accessError(access, requestId, tableId)

    // Dispatch in the background — large fan-outs (thousands of rows) issue
    // sequential trigger.dev calls and would otherwise hold the HTTP response
    // open for minutes, blocking the AI/copilot tool span and the UI mutation.
    void runWorkflowColumn({
      tableId,
      workspaceId,
      groupIds,
      mode: runMode,
      rowIds,
      requestId,
    }).catch((err) => {
      logger.error(`[${requestId}] run-column dispatch failed:`, toError(err).message)
    })

    return NextResponse.json({ success: true, data: { triggered: null } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid workspace ID') {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    logger.error(`run-column failed:`, error)
    return NextResponse.json({ error: 'Failed to run columns' }, { status: 500 })
  }
})
