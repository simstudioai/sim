import {
  v2DeletePermissionGroupContract,
  v2GetPermissionGroupContract,
  v2UpdatePermissionGroupContract,
} from '@/lib/api/contracts/v2/permission-groups'
import { presentPermissionGroup } from '@/lib/api/server/permission-group-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2PermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import {
  deletePermissionGroup,
  getPermissionGroup,
  updatePermissionGroup,
} from '@/lib/permission-groups/application/use-cases'

export const GET = defineV2JsonRoute({
  contract: v2GetPermissionGroupContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getPermissionGroup,
  present: (group) => ({ data: presentPermissionGroup(group) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdatePermissionGroupContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, changes: body }),
  useCase: updatePermissionGroup,
  present: (group) => ({ data: presentPermissionGroup(group) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeletePermissionGroupContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: deletePermissionGroup,
  present: (group) => ({ data: { id: group.id, deleted: true as const } }),
})
