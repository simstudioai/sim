import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteTableViewContract, updateTableViewContract } from '@/lib/api/contracts/tables'
import { parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { TableSchema } from '@/lib/table'
import { deleteTableView, TableViewValidationError, updateTableView } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableViewAPI')

interface TableViewRouteParams {
  params: Promise<{ tableId: string; viewId: string }>
}

/** PATCH /api/table/[tableId]/views/[viewId] - Rename, overwrite config, or set as default. */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: TableViewRouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(updateTableViewContract, request, context, {
        validationErrorResponse: (error) => validationErrorResponse(error),
      })
      if (!parsed.success) return parsed.response

      const { tableId, viewId } = parsed.data.params
      const { workspaceId, name, config, isDefault } = parsed.data.body

      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      if (result.table.workspaceId !== workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const columns = (result.table.schema as TableSchema).columns ?? []
      const view = await updateTableView({ viewId, tableId, name, config, isDefault, columns })

      return NextResponse.json({ success: true, data: { view } })
    } catch (error) {
      if (error instanceof TableViewValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      logger.error(`[${requestId}] Error updating table view:`, error)
      return NextResponse.json({ error: 'Failed to update view' }, { status: 500 })
    }
  }
)

/** DELETE /api/table/[tableId]/views/[viewId] - Remove a saved view. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: TableViewRouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(deleteTableViewContract, request, context, {
        validationErrorResponse: (error) => validationErrorResponse(error),
      })
      if (!parsed.success) return parsed.response

      const { tableId, viewId } = parsed.data.params
      const { workspaceId } = parsed.data.body

      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      if (result.table.workspaceId !== workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const deleted = await deleteTableView(viewId, tableId)
      if (!deleted) {
        return NextResponse.json({ error: 'View not found' }, { status: 404 })
      }

      return NextResponse.json({ success: true, data: { deleted: true } })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting table view:`, error)
      return NextResponse.json({ error: 'Failed to delete view' }, { status: 500 })
    }
  }
)
