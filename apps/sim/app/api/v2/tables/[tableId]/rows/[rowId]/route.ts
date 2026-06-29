import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
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
import { buildIdByName, buildNameById, rowDataNameToId, updateRow } from '@/lib/table'
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
        position: userTableRows.position,
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

    const nameById = buildNameById(result.table.schema as TableSchema)
    return v2Data(
      {
        row: toApiRow(
          {
            id: row.id,
            data: row.data as RowData,
            position: row.position,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          nameById
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
    const nameById = buildNameById(table.schema as TableSchema)
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

    return v2Data({ row: toApiRow(updatedRow, nameById) }, { rateLimit })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    const errorMessage = toError(error).message
    if (errorMessage === 'Row not found') return v2Error('NOT_FOUND', errorMessage)

    if (
      errorMessage.includes('Row size exceeds') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('must be unique') ||
      errorMessage.includes('Unique constraint violation') ||
      errorMessage.includes('Cannot set unique column')
    ) {
      return v2Error('BAD_REQUEST', errorMessage)
    }

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

    const [deletedRow] = await db
      .delete(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId)
        )
      )
      .returning({ id: userTableRows.id })

    if (!deletedRow) return v2Error('NOT_FOUND', 'Row not found')

    // v2 mirrors the bulk delete shape: always returns `deletedRowIds`.
    return v2Data({ deletedCount: 1, deletedRowIds: [deletedRow.id] }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting row`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
