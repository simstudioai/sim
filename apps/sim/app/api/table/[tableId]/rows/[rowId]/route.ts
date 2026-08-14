import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { readClientId } from '@/lib/api/client-id'
import {
  deleteTableRowContract,
  getTableQuerySchema,
  updateTableRowContract,
} from '@/lib/api/contracts/tables'
import { isZodError, parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RowData, TableSchema } from '@/lib/table'
import { updateRow } from '@/lib/table'
import { signalTableRowsChangedByActor } from '@/lib/table/events'
import { performDeleteTableRow } from '@/lib/table/orchestration'
import {
  createTableRowsResponse,
  createTableWriteProvenanceTargets,
  resolveTableWriteSecretProvenance,
} from '@/app/api/table/row-secret-provenance'
import { rowWireTranslators } from '@/app/api/table/row-wire'
import {
  accessError,
  checkAccess,
  orchestrationErrorResponse,
  orchestrationOutcomeErrorResponse,
  tableLockErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableRowAPI')

interface RowRouteParams {
  params: Promise<{ tableId: string; rowId: string }>
}

/** GET /api/table/[tableId]/rows/[rowId] - Retrieves a single row. */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RowRouteParams) => {
  const requestId = generateRequestId()
  const { tableId, rowId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = getTableQuerySchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
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
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved row ${rowId} from table ${tableId}`)

    const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)

    const responseBody = {
      success: true,
      data: {
        row: {
          id: row.id,
          data: wire.dataOut(row.data as RowData),
          position: row.position,
          createdAt:
            row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          updatedAt:
            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
        },
      },
    }
    return createTableRowsResponse({
      request,
      authType: authResult.authType,
      userId: authResult.userId,
      workspaceId: table.workspaceId,
      body: responseBody,
      rows: [{ ...row, data: row.data as RowData }],
    })
  } catch (error) {
    if (isZodError(error)) {
      return validationErrorResponse(error)
    }

    logger.error(`[${requestId}] Error getting row:`, error)
    return NextResponse.json({ error: 'Failed to get row' }, { status: 500 })
  }
})

/** PATCH /api/table/[tableId]/rows/[rowId] - Updates a single row (supports partial updates). */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(updateTableRowContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
    const validated = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const wire = rowWireTranslators(authResult.authType, table.schema as TableSchema)
    const rowData = validated.data as RowData
    const provenance = resolveTableWriteSecretProvenance({
      request,
      payload: validated,
      authType: authResult.authType,
      userId: authResult.userId,
      workspaceId: table.workspaceId,
      targets: createTableWriteProvenanceTargets([rowData], wire.dataIn),
      rowKeys: ['0'],
    })
    if (!provenance.success) return provenance.response
    const updatedRow = await updateRow(
      {
        tableId,
        rowId,
        data: wire.dataIn(rowData),
        workspaceId: validated.workspaceId,
        actorUserId: authResult.userId,
        secretProvenance: provenance.provenanceByRowKey?.['0'],
      },
      table,
      requestId
    )

    // Live-collab: tell open viewers the change landed so they refetch.
    signalTableRowsChangedByActor(tableId, readClientId(request))
    // Only `null` when a `cancellationGuard` is supplied and the SQL guard
    // rejects the write — this route doesn't pass one, so reaching null is a bug.
    if (!updatedRow) throw new Error('updateRow returned null without a cancellationGuard')
    // Auto-dispatch for user edits is handled inside `updateRow` (mode: 'new').
    // Firing a second mode: 'incomplete' dispatch here would race with the
    // `mode: 'new'` one AND bulk-clear sibling-group outputs (the incomplete
    // bulk-clear wipes ALL targeted columns when any one column on the row
    // is empty).

    const responseBody = {
      success: true,
      data: {
        row: {
          id: updatedRow.id,
          data: wire.dataOut(updatedRow.data),
          position: updatedRow.position,
          createdAt:
            updatedRow.createdAt instanceof Date
              ? updatedRow.createdAt.toISOString()
              : updatedRow.createdAt,
          updatedAt:
            updatedRow.updatedAt instanceof Date
              ? updatedRow.updatedAt.toISOString()
              : updatedRow.updatedAt,
        },
        message: 'Row updated successfully',
      },
    }
    return createTableRowsResponse({
      request,
      authType: authResult.authType,
      userId: authResult.userId,
      workspaceId: table.workspaceId,
      body: responseBody,
      rows: [updatedRow],
    })
  } catch (error) {
    const response = orchestrationErrorResponse(error)
    if (response) return response

    logger.error(`[${requestId}] Error updating row:`, error)
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 })
  }
})

/** DELETE /api/table/[tableId]/rows/[rowId] - Deletes a single row. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RowRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(deleteTableRowContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId, rowId } = parsed.data.params
    const validated = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const outcome = await performDeleteTableRow({ table, rowId, requestId })
    if (!outcome.success) {
      return orchestrationOutcomeErrorResponse(outcome, 'Failed to delete row')
    }

    // Live-collab: tell open viewers the change landed so they refetch.
    signalTableRowsChangedByActor(tableId, readClientId(request))

    return NextResponse.json({
      success: true,
      data: {
        message: 'Row deleted successfully',
        deletedCount: 1,
      },
    })
  } catch (error) {
    const lockError = tableLockErrorResponse(error)
    if (lockError) return lockError

    const classified = orchestrationErrorResponse(error)
    if (classified) return classified

    logger.error(`[${requestId}] Error deleting row:`, error)
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 })
  }
})
