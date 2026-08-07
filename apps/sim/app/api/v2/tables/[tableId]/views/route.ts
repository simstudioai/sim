import { v2CreateTableViewContract, v2ListTableViewsContract } from '@/lib/api/contracts/v2/tables'
import type { TableSchema } from '@/lib/table'
import { createTableView, listTableViews, TableViewValidationError } from '@/lib/table'
import {
  getRequiredUserEmail,
  getUserEmailsByIds,
  requireResolvedUserEmail,
} from '@/lib/users/queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2CursorList, v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { toApiView, v2TableAccessError } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/tables/[tableId]/views — Every saved view on the table.
 *
 * A table carries a bounded set of views, so this is one full page and
 * `nextCursor` is always `null`.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2ListTableViewsContract,
  rateLimitEndpoint: 'table-views',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { tableId } = input.params
    const { workspaceId } = input.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok || result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const views = await listTableViews(tableId, (result.table.schema as TableSchema).columns)

    const emailByUserId = await getUserEmailsByIds(
      views.flatMap((view) => (view.createdBy ? [view.createdBy] : []))
    )
    return v2CursorList(
      views.map((view) =>
        toApiView(
          view,
          view.createdBy ? requireResolvedUserEmail(emailByUserId, view.createdBy) : null
        )
      ),
      null,
      { rateLimit }
    )
  },
})

/** POST /api/v2/tables/[tableId]/views — Save a filter/sort/layout as a named view. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateTableViewContract,
  rateLimitEndpoint: 'table-views',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const { workspaceId, name, config } = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, rateLimit.principalUserId ?? userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      if (result.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const view = await createTableView({
        tableId,
        workspaceId,
        name,
        config,
        userId,
        columns: (result.table.schema as TableSchema).columns,
      })

      return v2Data(
        {
          view: toApiView(view, view.createdBy ? await getRequiredUserEmail(view.createdBy) : null),
        },
        { rateLimit, status: 201 }
      )
    } catch (error) {
      if (error instanceof TableViewValidationError) return v2Error('BAD_REQUEST', error.message)

      throw error
    }
  },
})
