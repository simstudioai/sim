import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2RunTableColumnContract } from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Filter, TableSchema } from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'
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
import {
  v2BulkPredicateToFilter,
  v2TableAccessError,
  v2TableLockError,
} from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableRunColumnAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/columns/run — Run workflow/enrichment groups.
 *
 * Asynchronous: the response acknowledges the dispatch, not the results. The
 * dispatcher walks the scoped rows and writes cells as runs land, so callers
 * poll the row endpoints. `dispatchId` is `null` where no background runner is
 * configured and cells execute inline.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-enrichment')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2RunTableColumnContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, groupIds, runMode, rowIds, filter, excludeRowIds, limit } =
      parsed.data.body

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

    logger.error(`[${requestId}] Error running table columns`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
