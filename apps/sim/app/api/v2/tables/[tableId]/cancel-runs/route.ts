import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CancelTableRunsContract } from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Filter, TableSchema } from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'
import { signalTableRowsChanged } from '@/lib/table/events'
import { cancelWorkflowGroupRuns } from '@/lib/table/workflow-columns'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2BulkPredicateToFilter, v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableCancelRunsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/cancel-runs — Stop in-flight cell runs.
 *
 * The counterpart to `POST /columns/run`, and distinct from
 * `POST /job/cancel`, which stops an import or delete. `scope: 'all'` cancels
 * every running and pending cell (optionally narrowed by `filter`); `row`
 * cancels one row's cells.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-enrichment')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2CancelTableRunsContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, scope, rowId, filter, excludeRowIds } = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'write')
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

    const cancelled = await cancelWorkflowGroupRuns(tableId, scope === 'row' ? rowId : undefined, {
      filter: legacyFilter,
      excludeRowIds,
    })

    // Cancelling clears the affected rows' exec state, so open readers must
    // refetch to pick up the cleared cells.
    signalTableRowsChanged(tableId)

    logger.info(`[${requestId}] Cancelled table runs`, { tableId, scope, rowId, cancelled })

    return v2Data({ cancelled }, { rateLimit })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)
    if (error instanceof TableQueryValidationError) return v2Error('BAD_REQUEST', error.message)

    logger.error(`[${requestId}] Error cancelling table runs`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
