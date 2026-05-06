import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1CreateTableContract, v1ListTablesContract } from '@/lib/api/contracts/v1/tables'
import { parseRequest, validationErrorResponseFromError } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createTable, getWorkspaceTableLimits, listTables, type TableSchema } from '@/lib/table'
import { normalizeColumn } from '@/app/api/table/utils'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TablesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v1/tables — List all tables in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1ListTablesContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    const tables = await listTables(workspaceId)

    return NextResponse.json({
      success: true,
      data: {
        tables: tables.map((t) => {
          const schemaData = t.schema as TableSchema
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            schema: {
              columns: schemaData.columns.map(normalizeColumn),
            },
            rowCount: t.rowCount,
            maxRows: t.maxRows,
            createdAt:
              t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
            updatedAt:
              t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
          }
        }),
        totalCount: tables.length,
      },
    })
  } catch (error) {
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    logger.error(`[${requestId}] Error listing tables:`, error)
    return NextResponse.json({ error: 'Failed to list tables' }, { status: 500 })
  }
})

/** POST /api/v1/tables — Create a new table. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    const parsed = await parseRequest(v1CreateTableContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const accessError = await validateWorkspaceAccess(
      rateLimit,
      userId,
      params.workspaceId,
      'write'
    )
    if (accessError) return accessError

    const planLimits = await getWorkspaceTableLimits(params.workspaceId)

    const normalizedSchema: TableSchema = {
      columns: params.schema.columns.map(normalizeColumn),
    }

    const table = await createTable(
      {
        name: params.name,
        description: params.description,
        schema: normalizedSchema,
        workspaceId: params.workspaceId,
        userId,
        maxRows: planLimits.maxRowsPerTable,
        maxTables: planLimits.maxTables,
      },
      requestId
    )

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_CREATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: table.name,
      description: `Created table "${table.name}" via API`,
      metadata: { columnCount: params.schema.columns.length },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
          schema: {
            columns: (table.schema as TableSchema).columns.map(normalizeColumn),
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
        message: 'Table created successfully',
      },
    })
  } catch (error) {
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    if (error instanceof Error) {
      if (error.message.includes('maximum table limit')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      if (
        error.message.includes('Invalid table name') ||
        error.message.includes('Invalid schema') ||
        error.message.includes('already exists')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    logger.error(`[${requestId}] Error creating table:`, error)
    return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
  }
})
