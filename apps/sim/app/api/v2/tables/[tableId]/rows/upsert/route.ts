import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2UpsertTableRowContract } from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RowData, TableSchema } from '@/lib/table'
import { buildIdByName, buildNameById, rowDataNameToId, upsertRow } from '@/lib/table'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiRow, v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableUpsertAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface UpsertRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/v2/tables/[tableId]/rows/upsert — Insert or update a row based on unique columns. */
export const POST = withRouteHandler(async (request: NextRequest, context: UpsertRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2UpsertTableRowContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return v2TableAccessError(result)

    const { table } = result
    if (table.workspaceId !== validated.workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const idByName = buildIdByName(table.schema as TableSchema)
    const nameById = buildNameById(table.schema as TableSchema)
    const upsertResult = await upsertRow(
      {
        tableId,
        workspaceId: validated.workspaceId,
        data: rowDataNameToId(validated.data as RowData, idByName),
        userId,
        conflictTarget: validated.conflictTarget,
      },
      table,
      requestId
    )

    // v2 includes `position` in the row object (via toApiRow) — v1 dropped it here.
    return v2Data(
      { row: toApiRow(upsertResult.row, nameById), operation: upsertResult.operation },
      { rateLimit }
    )
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    const errorMessage = toError(error).message
    if (
      errorMessage.includes('unique column') ||
      errorMessage.includes('Unique constraint violation') ||
      errorMessage.includes('conflictTarget') ||
      errorMessage.includes('row limit') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('Upsert requires') ||
      errorMessage.includes('Row size exceeds')
    ) {
      return v2Error('BAD_REQUEST', errorMessage)
    }

    logger.error(`[${requestId}] Error upserting row`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
