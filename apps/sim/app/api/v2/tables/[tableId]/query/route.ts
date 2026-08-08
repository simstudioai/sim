import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { V2_DEFAULT_ROW_LIMIT, v2QueryRowsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { queryTableRows } from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import { toApiRow } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2QueryRowsContract,
  operation: tableOperations.queryRows,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  parseOptions: { maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    predicate: body.predicate,
    sort: body.sort,
    cursor: body.cursor,
    limit:
      body.limit === undefined ? V2_DEFAULT_ROW_LIMIT : body.limit === 0 ? undefined : body.limit,
    includeTotal: false,
  }),
  useCase: queryTableRows,
  present: ({ table, rows, nextCursor }) => {
    const toNamedRow = namedRowMapper(table.schema.columns)
    return {
      data: rows.map((row) => toApiRow(row, toNamedRow)),
      nextCursor,
    }
  },
})
