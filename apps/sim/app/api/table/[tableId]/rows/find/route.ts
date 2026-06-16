import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { findTableRowsQuerySchema } from '@/lib/api/contracts/tables'
import { isZodError, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Sort } from '@/lib/table'
import { findRowMatches } from '@/lib/table/rows/service'
import { TableQueryValidationError } from '@/lib/table/sql'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRowsFindAPI')

interface TableRowsFindRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId]/rows/find - Case-insensitive substring search across all cells. */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: TableRowsFindRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const { searchParams } = new URL(request.url)
      const workspaceId = searchParams.get('workspaceId')
      const q = searchParams.get('q')
      const filterParam = searchParams.get('filter')
      const sortParam = searchParams.get('sort')

      let filter: Record<string, unknown> | undefined
      let sort: Sort | undefined

      try {
        if (filterParam) filter = JSON.parse(filterParam) as Record<string, unknown>
        if (sortParam) sort = JSON.parse(sortParam) as Sort
      } catch {
        return NextResponse.json({ error: 'Invalid filter or sort JSON' }, { status: 400 })
      }

      const validated = findTableRowsQuerySchema.parse({ workspaceId, q, filter, sort })

      const accessResult = await checkAccess(tableId, authResult.userId, 'read')
      if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

      const { table } = accessResult

      if (validated.workspaceId !== table.workspaceId) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${validated.workspaceId}, Actual: ${table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const { matches, truncated } = await findRowMatches(
        table,
        { q: validated.q, filter: validated.filter, sort: validated.sort },
        requestId
      )

      return NextResponse.json({ success: true, data: { matches, truncated } })
    } catch (error) {
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }

      if (error instanceof TableQueryValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      logger.error(`[${requestId}] Error finding rows:`, error)
      return NextResponse.json({ error: 'Failed to find rows' }, { status: 500 })
    }
  }
)
