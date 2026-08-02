import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2RunRowEnrichmentContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { signalTableRowsChanged } from '@/lib/table/events'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableAccessError, v2TableLockError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableRowEnrichmentAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RowEnrichmentRouteParams {
  params: Promise<{ tableId: string; rowId: string; groupId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]
 *
 * The single-cell case of `POST /columns/run`: runs one group for one row.
 * `mode: 'all'` because naming a specific cell is an explicit re-run request —
 * an already-populated cell must recompute rather than be skipped.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: RowEnrichmentRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-enrichment')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2RunRowEnrichmentContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { tableId, rowId, groupId } = parsed.data.params
      const { workspaceId } = parsed.data.body

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

      logger.error(`[${requestId}] Error running row enrichment`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
