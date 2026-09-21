import {
  v2AddPermissionGroupMemberContract,
  v2ListPermissionGroupMembersContract,
} from '@/lib/api/contracts/v2/permission-groups'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { presentPermissionGroupMember } from '@/lib/api/server/permission-group-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2PermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import {
  addPermissionGroupMember,
  listPermissionGroupMembers,
} from '@/lib/permission-groups/application/use-cases'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

function cursorFilters(params: { organizationId: string; groupId: string }) {
  return cursorScopeKey(cursorRoute(v2ListPermissionGroupMembersContract, params), {})
}

export const GET = defineV2JsonRoute({
  contract: v2ListPermissionGroupMembersContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.listMembers,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params)
    ),
  }),
  useCase: listPermissionGroupMembers,
  present: ({ data, nextCursorKeys }, { params, query }) => ({
    data: data.map(presentPermissionGroupMember),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorFilters(params)
    ),
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2AddPermissionGroupMemberContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.addMember,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: addPermissionGroupMember,
  present: ({ member }) => ({ data: presentPermissionGroupMember(member) }),
})
