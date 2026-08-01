import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  v2DeleteTableRowContract,
  v2GetTableRowContract,
  v2UpdateTableRowContract,
} from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RowData, TableSchema } from '@/lib/table'
import { buildIdByName, rowDataNameToId, updateRow } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { performDeleteTableRow } from '@/lib/table/orchestration'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiRow, v2TableAccessError, v2TableLockError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableRowAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** GET /api/v2/tables/[tableId]/rows/[rowId] — Get a single row. */
export const GET = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetTableRowContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok) return v2Error('NOT_FOUND', 'Table not found')

    if (result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const [row] = await db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId)
        )
      )
      .limit(1)

    if (!row) return v2Error('NOT_FOUND', 'Row not found')

    const toNamedRow = namedRowMapper((result.table.schema as TableSchema).columns)
    return v2Data(
      {
        row: toApiRow(
          {
            id: row.id,
            data: row.data as RowData,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          toNamedRow
        ),
      },
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error getting row`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/tables/[tableId]/rows/[rowId] — Partial update a single row. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateTableRowContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
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
    const toNamedRow = namedRowMapper((table.schema as TableSchema).columns)
    const updatedRow = await updateRow(
      {
        tableId,
        rowId,
        data: rowDataNameToId(validated.data as RowData, idByName),
        workspaceId: validated.workspaceId,
        actorUserId: userId,
      },
      table,
      requestId
    )
    // No `cancellationGuard` is passed, so `updateRow` can't return null here.
    // Defensive narrowing for TypeScript.
    if (!updatedRow) return v2Error('NOT_FOUND', 'Row not found')

    return v2Data({ row: toApiRow(updatedRow, toNamedRow) }, { rateLimit })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified

    logger.error(`[${requestId}] Error updating row`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/tables/[tableId]/rows/[rowId] — Delete a single row. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-row-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteTableRowContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return v2TableAccessError(result)

    if (result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const outcome = await performDeleteTableRow({ table: result.table, rowId, requestId })
    if (!outcome.success) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error ?? 'Failed to delete row')
    }

    // v2 mirrors the bulk delete shape: always returns `deletedRowIds`.
    return v2Data({ deletedCount: 1, deletedRowIds: [rowId] }, { rateLimit })
  } catch (error) {
    const lockError = v2TableLockError(error)
    if (lockError) return lockError
    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified
    logger.error(`[${requestId}] Error deleting row`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
