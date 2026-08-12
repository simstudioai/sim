import { v2CreateTableContract, v2ListTablesContract } from '@/lib/api/contracts/v2/tables'
import { INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { createTableUseCase, listTablesUseCase } from '@/lib/table/application/tables'
import { cursorSortKey, decodeSortedCursor, encodeSortedCursor } from '@/app/api/v2/lib/response'
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
  mapInput: ({ query }) => {
    const sort = cursorSortKey(query.sortBy, query.sortOrder)
    const decoded = decodeSortedCursor(query.cursor, sort)
    if (decoded.status === 'invalid') {
      throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    }
    return {
      workspaceId: query.workspaceId,
      folderPath: query.folderPath,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      limit: query.limit,
      after: decoded.status === 'ok' ? decoded.keys : undefined,
    }
  },
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
