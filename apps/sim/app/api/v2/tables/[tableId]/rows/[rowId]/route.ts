import {
  v2DeleteTableRowContract,
  v2GetTableRowContract,
  v2UpdateTableRowContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { deleteTableRow, readTableRow, updateTableRow } from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import { toApiRow } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetTableRowContract,
  operation: tableOperations.readRow,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, query }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    assertedWorkspaceId: query.workspaceId,
    includeRunState: query.includeRunState,
  }),
  useCase: readTableRow,
  present: ({ table, row, runState }) => ({
    data: toApiRow(row, namedRowMapper(table.schema.columns), runState),
  }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateTableRowContract,
  operation: tableOperations.updateRow,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    assertedWorkspaceId: body.workspaceId,
    data: body.data,
    strictWrite: true,
    dataKeying: 'names' as const,
  }),
  useCase: updateTableRow,
  present: ({ table, row }) => ({
    data: toApiRow(row, namedRowMapper(table.schema.columns)),
  }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteTableRowContract,
  operation: tableOperations.deleteRow,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, query }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: deleteTableRow,
  present: ({ deletedRowId }) => ({
    data: { id: deletedRowId, deleted: true as const },
  }),
})
