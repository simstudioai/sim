import { v2RunRowEnrichmentContract } from '@/lib/api/contracts/v2/tables'
import { signalTableRowsChanged } from '@/lib/table/events'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableAccessError, v2TableLockError } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]
 *
 * The single-cell case of `POST /columns/run`: runs one group for one row.
 * `mode: 'all'` because naming a specific cell is an explicit re-run request —
 * an already-populated cell must recompute rather than be skipped.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2RunRowEnrichmentContract,
  rateLimitEndpoint: 'table-enrichment',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId, rowId, groupId } = input.params
      const { workspaceId } = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const access = await checkAccess(tableId, userId, 'write')
      if (!access.ok) return v2TableAccessError(access)

      if (access.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const { dispatchId } = await runWorkflowColumn({
        tableId,
        workspaceId,
        groupIds: [groupId],
        rowIds: [rowId],
        mode: 'all',
        requestId,
        triggeredByUserId: userId,
      })

      signalTableRowsChanged(tableId)

      return v2Data({ dispatchId }, { rateLimit })
    } catch (error) {
      const lockError = v2TableLockError(error)
      if (lockError) return lockError

      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified

      throw error
    }
  },
})
