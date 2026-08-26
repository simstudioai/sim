import {
  v2CreateTableRowsContract,
  v2DeleteTableRowsContract,
  v2ListTableRowsContract,
  v2UpdateRowsByFilterContract,
} from '@/lib/api/contracts/v2/tables'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import {
  createTableRows,
  deleteTableRows,
  listTableRows,
  updateTableRows,
} from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import { encodeScopedCursor, readScopedCursor } from '@/app/api/v2/lib/response'
import { toApiRow } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The sequence a row cursor names a position in: this list, on THIS table.
 *
 * The row codec binds a token to the sort and predicate it was minted under but
 * carries no table identity, so an unfiltered token from one table decoded
 * cleanly against another and answered 200 with that other table's rows. The
 * table id lives in the path, so the route is the only place that knows it.
 */
function tableRowCursorScope(tableId: string): string {
  return cursorScopeKey(cursorRoute(v2ListTableRowsContract, { tableId }))
}

export const GET = defineV2JsonRoute({
  contract: v2ListTableRowsContract,
  operation: tableOperations.listRows,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, query }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: query.workspaceId,
    limit: query.limit,
    cursor: readScopedCursor(query.cursor, tableRowCursorScope(params.tableId)),
    includeRunState: query.includeRunState,
  }),
  useCase: listTableRows,
  present: ({ table, rows, nextCursor }, { params, query }) => {
    const toNamedRow = namedRowMapper(table.schema.columns)
    return {
      data: rows.map((row) =>
        toApiRow(row, toNamedRow, query.includeRunState ? row.executions : undefined)
      ),
      nextCursor: nextCursor
        ? encodeScopedCursor(tableRowCursorScope(params.tableId), nextCursor)
        : null,
    }
  },
})

export const POST = defineV2JsonRoute({
  contract: v2CreateTableRowsContract,
  operation: tableOperations.createRows,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) =>
    'rows' in body
      ? {
          kind: 'batch' as const,
          tableId: params.tableId,
          assertedWorkspaceId: body.workspaceId,
          rows: body.rows,
          strictWrite: true,
          dataKeying: 'names' as const,
        }
      : {
          kind: 'single' as const,
          tableId: params.tableId,
          assertedWorkspaceId: body.workspaceId,
          data: body.data,
          afterRowId: body.afterRowId,
          beforeRowId: body.beforeRowId,
          strictWrite: true,
          dataKeying: 'names' as const,
        },
  useCase: createTableRows,
  present: (result) => {
    const toNamedRow = namedRowMapper(result.table.schema.columns)
    return result.kind === 'single'
      ? { data: toApiRow(result.row, toNamedRow) }
      : {
          data: {
            rows: result.rows.map((row) => toApiRow(row, toNamedRow)),
            insertedCount: result.rows.length,
          },
        }
  },
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateRowsByFilterContract,
  operation: tableOperations.updateRows,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    filter: body.filter,
    data: body.data,
    limit: body.limit,
    strictWrite: true,
    dataKeying: 'names' as const,
  }),
  useCase: updateTableRows,
  present: ({ affectedCount, affectedRowIds }) => ({
    data: { updatedCount: affectedCount, updatedRowIds: affectedRowIds },
  }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteTableRowsContract,
  operation: tableOperations.deleteRows,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) =>
    body.rowIds
      ? {
          kind: 'ids' as const,
          tableId: params.tableId,
          assertedWorkspaceId: body.workspaceId,
          rowIds: body.rowIds,
        }
      : {
          kind: 'filter' as const,
          tableId: params.tableId,
          assertedWorkspaceId: body.workspaceId,
          filter: body.filter!,
          limit: body.limit,
        },
  useCase: deleteTableRows,
  present: (result) =>
    result.kind === 'ids'
      ? {
          data: {
            deletedCount: result.deletedCount,
            deletedRowIds: result.deletedRowIds,
            requestedCount: result.requestedCount,
            missingRowIds: result.missingRowIds,
          },
        }
      : {
          data: {
            deletedCount: result.affectedCount,
            deletedRowIds: result.affectedRowIds,
          },
        },
})
