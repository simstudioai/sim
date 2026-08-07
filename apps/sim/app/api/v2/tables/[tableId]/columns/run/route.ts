import { v2RunTableColumnContract } from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { Filter, TableSchema } from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'
import { signalTableRowsChanged } from '@/lib/table/events'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import {
  v2BulkPredicateToFilter,
  v2TableAccessError,
  v2TableLockError,
} from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/tables/[tableId]/columns/run — Run workflow/enrichment groups.
 *
 * Asynchronous: the response acknowledges the dispatch, not the results. The
 * dispatcher walks the scoped rows and writes cells as runs land, so callers
 * poll the row endpoints. `dispatchId` is `null` where no background runner is
 * configured and cells execute inline.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2RunTableColumnContract,
  rateLimitEndpoint: 'table-enrichment',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const { workspaceId, groupIds, runMode, rowIds, filter, excludeRowIds, limit } = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const access = await checkAccess(tableId, userId, 'write')
      if (!access.ok) return v2TableAccessError(access)

      if (access.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      // The public predicate is column-NAME keyed; the dispatcher compiles the
      // storage-keyed legacy filter. Translating up front also makes an unknown
      // field a 400 here rather than a dispatch that silently matches nothing.
      let legacyFilter: Filter | undefined
      if (filter) {
        legacyFilter = v2BulkPredicateToFilter(filter, access.table.schema as TableSchema)
      }

      const { dispatchId } = await runWorkflowColumn({
        tableId,
        workspaceId,
        groupIds,
        mode: runMode,
        rowIds,
        filter: legacyFilter,
        excludeRowIds,
        limit,
        requestId,
        triggeredByUserId: userId,
      })

      // Starting a run clears the target groups' cells to pending — a row change
      // open readers must pick up.
      signalTableRowsChanged(tableId)

      return v2Data({ dispatchId }, { rateLimit })
    } catch (error) {
      if (isZodError(error)) return v2ValidationError(error)
      if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

      const lockError = v2TableLockError(error)
      if (lockError) return lockError

      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified

      throw error
    }
  },
})
