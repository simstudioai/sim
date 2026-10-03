import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1UpsertTableRowContract } from '@/lib/api/contracts/v1/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RowData, TableSchema } from '@/lib/table'
import { upsertRow } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { buildIdByName, rowDataNameToId } from '@/lib/table/column-keys'
import { signalTableRowsChanged } from '@/lib/table/events'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import {
  accessError,
  checkAccess,
  orchestrationErrorResponse,
  tableLockErrorResponse,
} from '@/app/api/table/utils'
import {
  capabilityGovernedUserId,
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
  requireWorkspaceRequestActor,
  tableAccessPrincipal,
  v1ValidationErrorResponse,
  v1ValidationErrorResponseFromError,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableUpsertAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface UpsertRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/v1/tables/[tableId]/rows/upsert — Insert or update a row based on unique columns. */
export const POST = withRouteHandler(async (request: NextRequest, context: UpsertRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const parsed = await parseRequest(v1UpsertTableRowContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await checkWorkspaceScope(rateLimit, validated.workspaceId, 'write')
    if (scopeError) return scopeError
    const actor = await requireWorkspaceRequestActor(rateLimit, validated.workspaceId)
    if (!actor.ok) return actor.response
    const actorUserId = actor.actorUserId

    const result = await checkAccess(tableId, tableAccessPrincipal(rateLimit), 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const idByName = buildIdByName(table.schema as TableSchema)
    const toNamedRow = namedRowMapper((table.schema as TableSchema).columns)
    const rowData = rowDataNameToId(validated.data as RowData, idByName)
    const upsertResult = await upsertRow(
      {
        tableId,
        workspaceId: validated.workspaceId,
        data: rowData,
        userId: actorUserId,
        capabilityGovernedUserId: capabilityGovernedUserId(rateLimit),
        conflictTarget: validated.conflictTarget,
        secretProvenance: createExactEmptyTableRowSecretProvenance(rowData),
      },
      table,
      requestId
    )

    // Live-collab: tell open viewers the change landed so they refetch.
    signalTableRowsChanged(tableId)

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: upsertResult.row.id,
          data: toNamedRow(upsertResult.row.data),
          createdAt:
            upsertResult.row.createdAt instanceof Date
              ? upsertResult.row.createdAt.toISOString()
              : upsertResult.row.createdAt,
          updatedAt:
            upsertResult.row.updatedAt instanceof Date
              ? upsertResult.row.updatedAt.toISOString()
              : upsertResult.row.updatedAt,
        },
        operation: upsertResult.operation,
        message: `Row ${upsertResult.operation === 'update' ? 'updated' : 'inserted'} successfully`,
      },
    })
  } catch (error) {
    const lockError = tableLockErrorResponse(error)
    if (lockError) return lockError
    const validationResponse = v1ValidationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    const classified = orchestrationErrorResponse(error)
    if (classified) return classified

    logger.error(`[${requestId}] Error upserting row:`, error)
    return NextResponse.json({ error: 'Failed to upsert row' }, { status: 500 })
  }
})
