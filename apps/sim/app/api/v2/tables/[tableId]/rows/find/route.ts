import { v2FindTableRowsContract } from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { Filter, Sort, TableSchema } from '@/lib/table'
import { buildIdByName, sortSpecNamesToIds } from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'
import { validateSortSpec } from '@/lib/table/query-builder/validate'
import { findRowMatches } from '@/lib/table/rows/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { columnNameById, v2BulkPredicateToFilter } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/tables/[tableId]/rows/find — Case-insensitive substring search
 * across every cell, narrowed by the same predicate/sort grammar as
 * `POST /query`.
 *
 * Returns matching CELLS, not rows: each match carries the row's ordinal in the
 * same filtered+sorted view a `POST /query` with these arguments would return,
 * so a caller can jump straight to the page holding it.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2FindTableRowsContract,
  rateLimitEndpoint: 'table-rows-find',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const { workspaceId, q, predicate, sort } = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const accessResult = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'read')
      // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
      if (!accessResult.ok || accessResult.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const { table } = accessResult
      const schema = table.schema as TableSchema

      // The public wire is column-NAME keyed both ways: translate the predicate
      // and sort down to storage ids on the way in, and the matched column id
      // back to its name on the way out.
      let filter: Filter | undefined
      if (predicate) filter = v2BulkPredicateToFilter(predicate, schema)

      let sortObj: Sort | undefined
      if (sort?.length) {
        validateSortSpec(sort, schema.columns)
        const storageSort = sortSpecNamesToIds(sort, buildIdByName(schema))
        sortObj = Object.fromEntries(storageSort.map((s) => [s.field, s.direction]))
      }

      const { matches, truncated } = await findRowMatches(
        table,
        { q, filter, sort: sortObj },
        requestId
      )

      const toColumnName = columnNameById(schema)

      return v2Data(
        {
          matches: matches.map((match) => ({
            ordinal: match.ordinal,
            rowId: match.rowId,
            column: toColumnName(match.column),
          })),
          truncated,
        },
        { rateLimit }
      )
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

      throw error
    }
  },
})
