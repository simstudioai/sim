import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteTableViewContract,
  v2GetTableViewContract,
  v2UpdateTableViewContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { TableSchema } from '@/lib/table'
import {
  deleteTableView,
  getTableView,
  TableViewValidationError,
  updateTableView,
} from '@/lib/table'
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
import { toApiView, v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableViewDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableViewRouteParams {
  params: Promise<{ tableId: string; viewId: string }>
}

/** GET /api/v2/tables/[tableId]/views/[viewId] — One saved view. */
export const GET = withRouteHandler(async (request: NextRequest, context: TableViewRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-view-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetTableViewContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId, viewId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok || result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const view = await getTableView(viewId, tableId, (result.table.schema as TableSchema).columns)
    if (!view) return v2Error('NOT_FOUND', 'View not found')

    return v2Data({ view: toApiView(view) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error getting table view`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * PATCH /api/v2/tables/[tableId]/views/[viewId] — Rename, replace or merge the
 * config, or promote the view to the table's default.
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: TableViewRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-view-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2UpdateTableViewContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { tableId, viewId } = parsed.data.params
      const { workspaceId, name, config, configPatch, isDefault } = parsed.data.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      if (result.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const view = await updateTableView({
        viewId,
        tableId,
        name,
        config,
        configPatch,
        isDefault,
        columns: (result.table.schema as TableSchema).columns,
      })
      if (!view) return v2Error('NOT_FOUND', 'View not found')

      return v2Data({ view: toApiView(view) }, { rateLimit })
    } catch (error) {
      if (error instanceof TableViewValidationError) return v2Error('BAD_REQUEST', error.message)

      logger.error(`[${requestId}] Error updating table view`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)

/** DELETE /api/v2/tables/[tableId]/views/[viewId] — Remove a saved view. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: TableViewRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'table-view-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2DeleteTableViewContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { tableId, viewId } = parsed.data.params
      const { workspaceId } = parsed.data.query

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      if (result.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const deleted = await deleteTableView(viewId, tableId)
      if (!deleted) return v2Error('NOT_FOUND', 'View not found')

      return v2Data({ id: viewId }, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting table view`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
