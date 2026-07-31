import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v2ListTablesContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest, validationErrorResponseFromError } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listTables, type TableSchema } from '@/lib/table'
import { normalizeColumn, tablesV2GateError } from '@/app/api/table/utils'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V2TablesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Filters/ids can appear in query strings; keep list responses out of shared caches. */
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const

/** GET /api/v2/tables — list all tables in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'v2-tables')
    if (!rateLimit.allowed) return createRateLimitResponse(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2ListTablesContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    // After authz: the gate reads the workspace's org off the primary DB, and its
    // 404 would otherwise distinguish "not in the rollout cohort" from "no access".
    const gateError = await tablesV2GateError(userId, workspaceId)
    if (gateError) return gateError

    const tables = await listTables(workspaceId)

    return NextResponse.json(
      {
        success: true,
        data: {
          tables: tables.map((t) => {
            const schemaData = t.schema as TableSchema
            return {
              id: t.id,
              name: t.name,
              description: t.description,
              schema: { columns: schemaData.columns.map(normalizeColumn) },
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
      },
      { headers: PRIVATE_NO_STORE }
    )
  } catch (error) {
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    logger.error(`[${requestId}] Error listing tables:`, error)
    return NextResponse.json({ error: 'Failed to list tables' }, { status: 500 })
  }
})
