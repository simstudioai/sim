import type { NextResponse } from 'next/server'
import type { V1BatchInsertTableRowsBody } from '@/lib/api/contracts/v1/tables'
import {
  v2CreateTableRowsContract,
  v2DeleteTableRowsContract,
  v2ListTableRowsContract,
  v2UpdateRowsByFilterContract,
} from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { RowData, TableSchema } from '@/lib/table'
import {
  batchInsertRows,
  buildIdByName,
  deleteRowsByFilter,
  deleteRowsByIds,
  insertRow,
  rowDataNameToId,
  updateRowsByFilter,
  validateBatchRows,
  validateRowData,
  validateRowSize,
} from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { TableQueryValidationError } from '@/lib/table/errors'
import { queryRows } from '@/lib/table/rows/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { type RateLimitResult, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import {
  toApiRow,
  v2BulkPredicateToFilter,
  v2RowValidationError,
  v2RowWriteError,
  v2TableAccessError,
} from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Inserts a validated batch of rows. Authorizes against the table's own
 * workspace (IDOR guard) before any write, translates name-keyed row data to
 * storage ids, and returns the inserted rows in the canonical v2 envelope.
 */
async function handleBatchInsert(
  requestId: string,
  tableId: string,
  validated: V1BatchInsertTableRowsBody,
  userId: string,
  rateLimit: RateLimitResult
): Promise<NextResponse> {
  const accessResult = await checkAccess(tableId, userId, 'write')
  if (!accessResult.ok) return v2TableAccessError(accessResult)

  const { table } = accessResult
  if (validated.workspaceId !== table.workspaceId) {
    return v2Error('NOT_FOUND', 'Table not found')
  }

  // External callers key row data by column name; storage keys by id.
  const idByName = buildIdByName(table.schema as TableSchema)
  const toNamedRow = namedRowMapper((table.schema as TableSchema).columns)
  const rows = (validated.rows as RowData[]).map((r) => rowDataNameToId(r, idByName))

  const validation = await validateBatchRows({
    rows,
    schema: table.schema as TableSchema,
    tableId,
  })
  if (!validation.valid) return v2RowValidationError(validation.response)

  try {
    const insertedRows = await batchInsertRows(
      { tableId, rows, workspaceId: validated.workspaceId, userId },
      table,
      requestId
    )

    return v2Data(
      {
        rows: insertedRows.map((r) => toApiRow(r, toNamedRow)),
        insertedCount: insertedRows.length,
      },
      { rateLimit }
    )
  } catch (error) {
    const response = v2RowWriteError(error)
    if (response) return response

    throw error
  }
}

/**
 * GET /api/v2/tables/[tableId]/rows — Plain cursor page over the default row
 * order. Filtered/sorted reads go through `POST /query`.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2ListTableRowsContract,
  rateLimitEndpoint: 'table-rows',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.query

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const accessResult = await checkAccess(tableId, userId, 'read')
      // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
      if (!accessResult.ok) return v2Error('NOT_FOUND', 'Table not found')

      const { table } = accessResult
      if (validated.workspaceId !== table.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const toNamedRow = namedRowMapper((table.schema as TableSchema).columns)

      // Cursor-uniform v2 pagination: the opaque cursor encodes the underlying
      // offset (upgradeable to keyset later without an interface change). Total row
      // count is intentionally omitted here — it's available as `rowCount` on the table.
      const offset = validated.cursor
        ? (decodeCursor<{ offset: number }>(validated.cursor)?.offset ?? 0)
        : 0

      const result = await queryRows(
        table,
        {
          limit: validated.limit,
          offset,
          includeTotal: true,
          withExecutions: false,
        },
        requestId
      )

      const total = result.totalCount ?? 0
      const hasMore = offset + result.rowCount < total
      const nextCursor = hasMore ? encodeCursor({ offset: offset + validated.limit }) : null

      return v2CursorList(
        result.rows.map((r) => toApiRow(r, toNamedRow)),
        nextCursor,
        { rateLimit }
      )
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

      throw error
    }
  },
})

/** POST /api/v2/tables/[tableId]/rows — Insert row(s). Supports single or batch. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateTableRowsContract,
  rateLimitEndpoint: 'table-rows',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params

      if ('rows' in input.body) {
        const batchValidated = input.body
        const scopeError = await resolveWorkspaceScope(rateLimit, batchValidated.workspaceId)
        if (scopeError) return v2WorkspaceAccessError(scopeError)
        return handleBatchInsert(requestId, tableId, batchValidated, userId, rateLimit)
      }

      const validated = input.body
      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const accessResult = await checkAccess(tableId, userId, 'write')
      if (!accessResult.ok) return v2TableAccessError(accessResult)

      const { table } = accessResult
      if (validated.workspaceId !== table.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const idByName = buildIdByName(table.schema as TableSchema)
      const toNamedRow = namedRowMapper((table.schema as TableSchema).columns)
      const rowData = rowDataNameToId(validated.data as RowData, idByName)

      const validation = await validateRowData({
        rowData,
        schema: table.schema as TableSchema,
        tableId,
      })
      if (!validation.valid) return v2RowValidationError(validation.response)

      const row = await insertRow(
        { tableId, data: rowData, workspaceId: validated.workspaceId, userId },
        table,
        requestId
      )

      return v2Data({ row: toApiRow(row, toNamedRow) }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)

      const response = v2RowWriteError(error)
      if (response) return response

      throw error
    }
  },
})

/** PUT /api/v2/tables/[tableId]/rows — Bulk update rows by predicate filter. */
export const PUT = withPublicApiRouteHandler({
  contract: v2UpdateRowsByFilterContract,
  rateLimitEndpoint: 'table-rows',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const accessResult = await checkAccess(tableId, userId, 'write')
      if (!accessResult.ok) return v2TableAccessError(accessResult)

      const { table } = accessResult
      if (validated.workspaceId !== table.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const idByName = buildIdByName(table.schema as TableSchema)
      const patchData = rowDataNameToId(validated.data as RowData, idByName)

      const sizeValidation = validateRowSize(patchData)
      if (!sizeValidation.valid) {
        return v2Error('BAD_REQUEST', 'Invalid row data', { details: sizeValidation.errors })
      }

      const result = await updateRowsByFilter(
        table,
        {
          filter: v2BulkPredicateToFilter(validated.filter, table.schema as TableSchema),
          data: patchData,
          limit: validated.limit,
          actorUserId: userId,
        },
        requestId
      )

      // v2 always returns `updatedRowIds` ([] when nothing matched); v1 dropped it
      // on the zero-match branch.
      return v2Data(
        { updatedCount: result.affectedCount, updatedRowIds: result.affectedRowIds },
        { rateLimit }
      )
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

      const response = v2RowWriteError(error)
      if (response) return response

      throw error
    }
  },
})

/** DELETE /api/v2/tables/[tableId]/rows — Delete rows by predicate filter or IDs. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteTableRowsContract,
  rateLimitEndpoint: 'table-rows',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const accessResult = await checkAccess(tableId, userId, 'write')
      if (!accessResult.ok) return v2TableAccessError(accessResult)

      const { table } = accessResult
      if (validated.workspaceId !== table.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      // id-based and filter-based deletes share one envelope; `requestedCount`/
      // `missingRowIds` are populated only for the id-based delete (which has a
      // requested set) and omitted for the filter-based delete.
      if (validated.rowIds) {
        const result = await deleteRowsByIds(
          table,
          { tableId, rowIds: validated.rowIds, workspaceId: validated.workspaceId },
          requestId
        )

        return v2Data(
          {
            deletedCount: result.deletedCount,
            deletedRowIds: result.deletedRowIds,
            requestedCount: result.requestedCount,
            missingRowIds: result.missingRowIds,
          },
          { rateLimit }
        )
      }

      const result = await deleteRowsByFilter(
        table,
        {
          filter: v2BulkPredicateToFilter(validated.filter!, table.schema as TableSchema),
          limit: validated.limit,
        },
        requestId
      )

      return v2Data(
        { deletedCount: result.affectedCount, deletedRowIds: result.affectedRowIds },
        { rateLimit }
      )
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

      const response = v2RowWriteError(error)
      if (response) return response

      throw error
    }
  },
})
