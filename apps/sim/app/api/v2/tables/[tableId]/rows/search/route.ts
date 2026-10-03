import { v2SearchTableRowsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { searchTableRows } from '@/lib/table/application/rows'
import { columnNameById } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2SearchTableRowsContract,
  operation: tableOperations.searchRows,
  /** POST carries structured filters but performs a read-only search. */
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    q: body.q,
    predicate: body.predicate,
    sort: body.sort,
  }),
  useCase: searchTableRows,
  present: ({ table, matches, truncated }) => {
    const toColumnName = columnNameById(table.schema)
    return {
      data: {
        matches: matches.map((match) => ({
          ordinal: match.ordinal,
          rowId: match.rowId,
          column: toColumnName(match.column),
        })),
        truncated,
      },
    }
  },
})
