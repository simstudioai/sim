import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { tableIdParamsSchema } from '@/lib/api/contracts/tables'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getTableById } from '@/lib/table'
import { performRestoreTable } from '@/lib/table/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreTableAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) => {
    const requestId = generateRequestId()
    const { tableId } = tableIdParamsSchema.parse(await params)

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const table = await getTableById(tableId, { includeArchived: true })
      if (!table) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      const permission = await getUserEntityPermissions(auth.userId, 'workspace', table.workspaceId)
      if (permission !== 'admin' && permission !== 'write') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const result = await performRestoreTable({ tableId, userId: auth.userId, requestId })
      if (!result.success) {
        const status =
          result.errorCode === 'not_found' ? 404 : result.errorCode === 'conflict' ? 409 : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      logger.info(`[${requestId}] Restored table ${tableId}`)

      return NextResponse.json({
        success: true,
        data: { table: result.table },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error restoring table ${tableId}`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Internal server error') },
        { status: 500 }
      )
    }
  }
)
