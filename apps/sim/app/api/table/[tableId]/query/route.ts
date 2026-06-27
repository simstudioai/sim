import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { queryTableRowsV2Contract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { isZodError, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Sort, TableSchema } from '@/lib/table'
import { decodeCursor } from '@/lib/table/rows/cursor'
import { queryRows } from '@/lib/table/rows/service'
import { TableQueryValidationError } from '@/lib/table/sql'
import { rowWireTranslators } from '@/app/api/table/row-wire'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableQueryV2API')

interface TableQueryV2RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/query — v2 row query. Structured `all`/`any`
 * predicate grammar + opaque cursor pagination (no offset on the wire). Shares
 * the same engine as the legacy GET /rows route via `queryRows`.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: TableQueryV2RouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(queryTableRowsV2Contract, request, context)
      if (!parsed.success) return parsed.response
      const { params, body } = parsed.data
      const { tableId } = params

      const accessResult = await checkAccess(tableId, authResult.userId, 'read')
      if (!accessResult.ok) return accessError(accessResult, requestId, tableId)
      const { table } = accessResult

      if (body.workspaceId !== table.workspaceId) {
        logger.warn(
          `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${body.workspaceId}, Actual: ${table.workspaceId}`
        )
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)
      const cursor = body.cursor ? decodeCursor(body.cursor) : undefined

      const sortSpec = body.sort ? wire.sortSpecIn(body.sort) : undefined
      const sort: Sort | undefined = sortSpec?.length
        ? Object.fromEntries(sortSpec.map((s) => [s.field, s.direction]))
        : undefined

      const result = await queryRows(
        table,
        {
          predicate: body.predicate ? wire.predicateIn(body.predicate) : undefined,
          sort,
          limit: body.limit,
          after: cursor?.after,
          offset: cursor?.offset,
          // Only the first page (no inbound cursor) pays for the total count.
          includeTotal: !body.cursor,
        },
        requestId
      )

      return NextResponse.json({
        success: true,
        data: {
          rows: result.rows.map((r) => ({
            id: r.id,
            data: wire.dataOut(r.data),
            executions: r.executions,
            position: r.position,
            orderKey: r.orderKey ?? undefined,
            createdAt:
              r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            updatedAt:
              r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
          })),
          rowCount: result.rowCount,
          totalCount: result.totalCount,
          limit: result.limit,
          nextCursor: result.nextCursor,
        },
      })
    } catch (error) {
      if (isZodError(error)) return validationErrorResponse(error)
      if (error instanceof TableQueryValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error instanceof Error && error.message === 'Invalid cursor') {
        return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
      }
      logger.error(`[${requestId}] Error querying rows (v2):`, error)
      return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
    }
  }
)
