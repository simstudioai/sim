import {
  v2AddTableColumnContract,
  v2DeleteTableColumnContract,
  v2UpdateTableColumnContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import type { TableDefinition } from '@/lib/table'
import { v2TableErrorPolicies } from '@/lib/table/api'
import {
  addTableColumnUseCase,
  deleteTableColumnUseCase,
  updateTableColumnUseCase,
} from '@/lib/table/application/columns'
import { tableOperations } from '@/lib/table/application/operations'
import { normalizeColumn } from '@/lib/table/wire'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function presentColumns(result: { table: TableDefinition }) {
  return { data: { columns: result.table.schema.columns.map(normalizeColumn) } }
}

export const POST = defineV2JsonRoute({
  contract: v2AddTableColumnContract,
  operation: tableOperations.addColumn,
  useCase: addTableColumnUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: presentColumns,
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateTableColumnContract,
  operation: tableOperations.updateColumn,
  useCase: updateTableColumnUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: ({ table, unmigrated }) => ({
    data: { columns: table.schema.columns.map(normalizeColumn), unmigrated },
  }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteTableColumnContract,
  operation: tableOperations.deleteColumn,
  useCase: deleteTableColumnUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({ tableId: params.tableId, ...body }),
  present: presentColumns,
})
