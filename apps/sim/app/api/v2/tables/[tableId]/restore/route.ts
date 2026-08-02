import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2RestoreTableContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getTableById } from '@/lib/table'
import { performRestoreTable } from '@/lib/table/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiTable } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableRestoreAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/restore — Un-archive a table.
 *
 * The only table endpoint that cannot use `checkAccess`: its target is archived
 * by definition, and `checkAccess` resolves active tables only. The permission
 * check is therefore done against the archived row's own workspace, which is
 * also what makes the workspace-match check an IDOR guard rather than a
 * formality.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-restore')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2RestoreTableContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId } = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const archived = await getTableById(tableId, { includeArchived: true })
    // Mask a missing table and a foreign one alike so archived-table existence
    // never leaks across workspaces.
    if (!archived || archived.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const permission = await getUserEntityPermissions(userId, 'workspace', archived.workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return v2Error('FORBIDDEN', 'Access denied')
    }

    const outcome = await performRestoreTable({ tableId, userId, requestId })
    if (!outcome.success || !outcome.table) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error ?? 'Failed to restore table')
    }

    return v2Data({ table: toApiTable(outcome.table) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error restoring table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
