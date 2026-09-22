import {
  v2CreatePermissionGroupContract,
  v2ListPermissionGroupsContract,
} from '@/lib/api/contracts/v2/permission-groups'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { presentPermissionGroup } from '@/lib/api/server/permission-group-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2PermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import {
  createPermissionGroup,
  listPermissionGroups,
} from '@/lib/permission-groups/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

function cursorFilters(params: { organizationId: string }, query: { search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListPermissionGroupsContract, params), {
    search: query.search,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListPermissionGroupsContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.list,
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
  useCase: listPermissionGroups,
  present: ({ data, nextCursorKeys }, { params, query }) => ({
    data: data.map(presentPermissionGroup),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params, query)
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreatePermissionGroupContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, changes: body }),
  useCase: createPermissionGroup,
  present: (group) => ({ data: presentPermissionGroup(group) }),
})
