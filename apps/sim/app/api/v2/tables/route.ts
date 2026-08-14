import { v2CreateTableContract, v2ListTablesContract } from '@/lib/api/contracts/v2/tables'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { createTableUseCase, listTablesUseCase } from '@/lib/table/application/tables'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import { toApiTable, toApiTables } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which tables, in which order, this list returns. */
function tableCursorFilters(query: { workspaceId: string; folderPath?: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListTablesContract), {
    workspaceId: query.workspaceId,
    folderPath: query.folderPath,
    search: query.search,
  })
}

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
    after: readSortedCursor(query.cursor, query.sortBy, query.sortOrder, tableCursorFilters(query)),
  }),
  present: async ({ tables, nextKeys }, { query }) => ({
    data: await toApiTables(tables),
    nextCursor: writeSortedCursor(
      nextKeys,
      query.sortBy,
      query.sortOrder,
      tableCursorFilters(query)
    ),
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
