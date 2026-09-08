import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { V2_DEFAULT_ROW_LIMIT, v2QueryRowsContract } from '@/lib/api/contracts/v2/tables'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { queryTableRows } from '@/lib/table/application/rows'
import { namedRowMapper } from '@/lib/table/cell-format'
import { encodeScopedCursor, readScopedCursor } from '@/app/api/v2/lib/response'
import { toApiRow } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The sequence a query cursor names a position in: this list, on THIS table.
 *
 * The row codec binds the predicate and sort a page was produced under, but not
 * the table — so an unfiltered token from one table decoded cleanly against
 * another and answered 200 with that other table's rows. The table id lives in
 * the path, so the route is the only place that knows it.
 */
function queryRowCursorScope(tableId: string): string {
  return cursorScopeKey(cursorRoute(v2QueryRowsContract, { tableId }))
}

export const POST = defineV2JsonRoute({
  contract: v2QueryRowsContract,
  operation: tableOperations.queryRows,
  /** POST carries structured filters but performs a read-only query. */
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  parseOptions: { maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    predicate: body.predicate,
    sort: body.sort,
    cursor: readScopedCursor(body.cursor, queryRowCursorScope(params.tableId)),
    limit:
      body.limit === undefined ? V2_DEFAULT_ROW_LIMIT : body.limit === 0 ? undefined : body.limit,
    includeTotal: false,
    includeRunState: body.includeRunState,
  }),
  useCase: queryTableRows,
  present: ({ table, rows, nextCursor }, { params, body }) => {
    const toNamedRow = namedRowMapper(table.schema.columns)
    return {
      data: rows.map((row) =>
        toApiRow(row, toNamedRow, body.includeRunState ? row.executions : undefined)
      ),
      nextCursor: nextCursor
        ? encodeScopedCursor(queryRowCursorScope(params.tableId), nextCursor)
        : null,
    }
  },
})
