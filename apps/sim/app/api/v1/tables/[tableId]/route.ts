import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteTable, type TableSchema } from '@/lib/table'
import { accessError, checkAccess, normalizeColumn } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/v1/tables/[tableId] — Get table details. */
export const GET = withRouteHandler(async (request: NextRequest, { params }: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId } = await params
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId query parameter is required' },
        { status: 400 }
      )
    }

    const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const schemaData = table.schema as TableSchema

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
          schema: {
            columns: schemaData.columns.map(normalizeColumn),
          },
          rowCount: table.rowCount,
          maxRows: table.maxRows,
          createdAt:
            table.createdAt instanceof Date
              ? table.createdAt.toISOString()
              : String(table.createdAt),
          updatedAt:
            table.updatedAt instanceof Date
              ? table.updatedAt.toISOString()
              : String(table.updatedAt),
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting table:`, error)
    return NextResponse.json({ error: 'Failed to get table' }, { status: 500 })
  }
})

/** DELETE /api/v1/tables/[tableId] — Archive a table. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: TableRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-detail')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const { tableId } = await params
      const { searchParams } = new URL(request.url)
      const workspaceId = searchParams.get('workspaceId')

      if (!workspaceId) {
        return NextResponse.json(
          { error: 'workspaceId query parameter is required' },
          { status: 400 }
        )
      }

      const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return scopeError

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      if (result.table.workspaceId !== workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      await deleteTable(tableId, requestId)

      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.TABLE_DELETED,
        resourceType: AuditResourceType.TABLE,
        resourceId: tableId,
        resourceName: result.table.name,
        description: `Archived table "${result.table.name}"`,
        request,
      })

      return NextResponse.json({
        success: true,
        data: {
          message: 'Table archived successfully',
        },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting table:`, error)
      return NextResponse.json({ error: 'Failed to delete table' }, { status: 500 })
    }
  }
)
