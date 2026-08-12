import { v2CreateTableContract, v2ListTablesContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { createTableUseCase, listTablesUseCase } from '@/lib/table/application/tables'
import { cursorSortKey, encodeSortedCursor, readSortedCursor } from '@/app/api/v2/lib/response'
import { toApiTable, toApiTables } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListTablesContract,
  operation: tableOperations.list,
  useCase: listTablesUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    folderPath: query.folderPath,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(query.cursor, query.sortBy, query.sortOrder),
  }),
  present: async ({ tables, nextKeys, sortBy, sortOrder }) => ({
    data: await toApiTables(tables),
    nextCursor: nextKeys ? encodeSortedCursor(cursorSortKey(sortBy, sortOrder), nextKeys) : null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateTableContract,
  operation: tableOperations.create,
  useCase: createTableUseCase,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.default,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    schema: body.schema,
    folderPath: body.folderPath,
  }),
  present: async ({ table, folderPath }) => ({
    data: await toApiTable(table, folderPath),
  }),
})
