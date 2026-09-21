import { v2ListPermissionGroupWorkspacesContract } from '@/lib/api/contracts/v2/permission-groups'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2PermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { listPermissionGroupWorkspaces } from '@/lib/permission-groups/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

function cursorFilters(params: { organizationId: string }, query: { search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListPermissionGroupWorkspacesContract, params), {
    search: query.search,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListPermissionGroupWorkspacesContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.listWorkspaces,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params, query)
    ),
  }),
  useCase: listPermissionGroupWorkspaces,
  present: ({ data, nextCursorKeys }, { params, query }) => ({
    data,
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params, query)
    ),
  }),
})
