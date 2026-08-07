import { createLogger } from '@sim/logger'
import { v2CancelTableRunsContract } from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { Filter, TableSchema } from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'
import { signalTableRowsChanged } from '@/lib/table/events'
import { cancelWorkflowGroupRuns } from '@/lib/table/workflow-columns'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2BulkPredicateToFilter, v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableCancelRunsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/tables/[tableId]/cancel-runs — Stop in-flight cell runs.
 *
 * The counterpart to `POST /columns/run`, and distinct from
 * `POST /job/cancel`, which stops an import or delete. `scope: 'all'` cancels
 * every running and pending cell (optionally narrowed by `filter`); `row`
 * cancels one row's cells.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2CancelTableRunsContract,
  rateLimitEndpoint: 'table-enrichment',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const { workspaceId, scope, rowId, filter, excludeRowIds } = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const access = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'write')
      if (!access.ok) return v2TableAccessError(access)

      if (access.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      // The public predicate is column-NAME keyed; the runners compile the
      // storage-keyed legacy filter. Translating up front makes an unknown field
      // a 400 rather than a cancel that silently matches nothing.
      let legacyFilter: Filter | undefined
      if (filter) {
        legacyFilter = v2BulkPredicateToFilter(filter, access.table.schema as TableSchema)
      }

      const cancelled = await cancelWorkflowGroupRuns(
        tableId,
        scope === 'row' ? rowId : undefined,
        {
          filter: legacyFilter,
          excludeRowIds,
        }
      )

      // Cancelling clears the affected rows' exec state, so open readers must
      // refetch to pick up the cleared cells.
      signalTableRowsChanged(tableId)

      logger.info(`[${requestId}] Cancelled table runs`, { tableId, scope, rowId, cancelled })

      return v2Data({ cancelled }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

      throw error
    }
  },
})
