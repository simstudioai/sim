import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateTableContract, v2ListTablesContract } from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createTable, getWorkspaceTableLimits, listTables, type TableSchema } from '@/lib/table'
import { normalizeColumn } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiTable } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TablesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/tables — List all tables in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2ListTablesContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const tables = await listTables(workspaceId)
    const items = tables.map(toApiTable)

    // `listTables` returns the full bounded workspace set → single page.
    return v2CursorList(items, null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing tables`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/tables — Create a new table. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2CreateTableContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, params.workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

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

    return v2Data({ table: toApiTable(table) }, { rateLimit, status: 201 })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    if (error instanceof Error) {
      if (error.message.includes('maximum table limit')) {
        return v2Error('FORBIDDEN', error.message)
      }
      if (
        error.message.includes('Invalid table name') ||
        error.message.includes('Invalid schema') ||
        error.message.includes('already exists')
      ) {
        return v2Error('BAD_REQUEST', error.message)
      }
    }

    logger.error(`[${requestId}] Error creating table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
