import {
  v2DeleteTableViewContract,
  v2GetTableViewContract,
  v2UpdateTableViewContract,
} from '@/lib/api/contracts/v2/tables'
import type { TableSchema } from '@/lib/table'
import {
  deleteTableView,
  getTableView,
  TableViewValidationError,
  updateTableView,
} from '@/lib/table'
import { getRequiredUserEmail } from '@/lib/users/queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { toApiView, v2TableAccessError } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/tables/[tableId]/views/[viewId] — One saved view. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetTableViewContract,
  rateLimitEndpoint: 'table-view-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { tableId, viewId } = input.params
    const { workspaceId } = input.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok || result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const view = await getTableView(viewId, tableId, (result.table.schema as TableSchema).columns)
    if (!view) return v2Error('NOT_FOUND', 'View not found')

    return v2Data(
      { view: toApiView(view, view.createdBy ? await getRequiredUserEmail(view.createdBy) : null) },
      { rateLimit }
    )
  },
})

/**
 * PATCH /api/v2/tables/[tableId]/views/[viewId] — Rename, replace or merge the
 * config, or promote the view to the table's default.
 */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateTableViewContract,
  rateLimitEndpoint: 'table-view-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { tableId, viewId } = input.params
      const { workspaceId, name, config, configPatch, isDefault } = input.body

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

      return v2Data(
        {
          view: toApiView(view, view.createdBy ? await getRequiredUserEmail(view.createdBy) : null),
        },
        { rateLimit }
      )
    } catch (error) {
      if (error instanceof TableViewValidationError) return v2Error('BAD_REQUEST', error.message)

      throw error
    }
  },
})

/** DELETE /api/v2/tables/[tableId]/views/[viewId] — Remove a saved view. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteTableViewContract,
  rateLimitEndpoint: 'table-view-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { tableId, viewId } = input.params
    const { workspaceId } = input.query

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
  },
})
