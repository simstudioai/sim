import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createTableViewContract, listTableViewsContract } from '@/lib/api/contracts/tables'
import { parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { TableSchema } from '@/lib/table'
import { createTableView, listTableViews, TableViewValidationError } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableViewsAPI')

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId]/views - List every saved view on a table. */
export const GET = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(listTableViewsContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    if (result.table.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const columns = (result.table.schema as TableSchema).columns ?? []
    const views = await listTableViews(tableId, columns)

    return NextResponse.json({ success: true, data: { views } })
  } catch (error) {
    logger.error(`[${requestId}] Error listing table views:`, error)
    return NextResponse.json({ error: 'Failed to list views' }, { status: 500 })
  }
})

/** POST /api/table/[tableId]/views - Save the current filter/sort/layout as a named view. */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(createTableViewContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, name, config } = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    if (result.table.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const columns = (result.table.schema as TableSchema).columns ?? []
    const view = await createTableView({
      tableId,
      workspaceId,
      name,
      config,
      userId: authResult.userId,
      columns,
    })

    return NextResponse.json({ success: true, data: { view } })
  } catch (error) {
    if (error instanceof TableViewValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error(`[${requestId}] Error creating table view:`, error)
    return NextResponse.json({ error: 'Failed to create view' }, { status: 500 })
  }
})
