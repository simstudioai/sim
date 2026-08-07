import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  v2DeleteTableRowContract,
  v2GetTableRowContract,
  v2UpdateTableRowContract,
} from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { RowData, TableSchema } from '@/lib/table'
import { buildIdByName, rowDataNameToId, updateRow } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { performDeleteTableRow } from '@/lib/table/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import {
  toApiRow,
  v2TableAccessError,
  v2TableLockError,
  v2TableOrchestrationError,
} from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/tables/[tableId]/rows/[rowId] — Get a single row. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetTableRowContract,
  rateLimitEndpoint: 'table-row-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { tableId, rowId } = input.params
    const { workspaceId } = input.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'read')
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
  },
})

/** PATCH /api/v2/tables/[tableId]/rows/[rowId] — Partial update a single row. */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateTableRowContract,
  rateLimitEndpoint: 'table-row-detail',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId, rowId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'write')
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

      throw error
    }
  },
})

/** DELETE /api/v2/tables/[tableId]/rows/[rowId] — Delete a single row. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteTableRowContract,
  rateLimitEndpoint: 'table-row-detail',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId, rowId } = input.params
      const { workspaceId } = input.query

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      if (result.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const outcome = await performDeleteTableRow({ table: result.table, rowId, requestId })
      if (!outcome.success) {
        return v2TableOrchestrationError(outcome, 'Failed to delete row')
      }

      // v2 mirrors the bulk delete shape: always returns `deletedRowIds`.
      return v2Data({ deletedCount: 1, deletedRowIds: [rowId] }, { rateLimit })
    } catch (error) {
      const lockError = v2TableLockError(error)
      if (lockError) return lockError
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
