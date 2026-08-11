import { v2FindTableRowsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { findTableRows } from '@/lib/table/application/rows'
import { columnNameById } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2FindTableRowsContract,
  operation: tableOperations.findRows,
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
  useCase: findTableRows,
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
