import {
  deletePermissionGroupContract,
  getPermissionGroupContract,
  updatePermissionGroupContract,
} from '@/lib/api/contracts/permission-groups'
import { presentPermissionGroup } from '@/lib/api/server/permission-group-presenters'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import {
  deletePermissionGroup,
  getPermissionGroup,
  updatePermissionGroup,
} from '@/lib/permission-groups/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: getPermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, groupId: params.groupId }),
  useCase: getPermissionGroup,
  present: (group) => ({ permissionGroup: presentPermissionGroup(group) }),
})

export const PUT = defineInternalJsonRoute({
  contract: updatePermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    groupId: params.groupId,
    changes: body,
  }),
  useCase: updatePermissionGroup,
  present: (group) => ({ permissionGroup: presentPermissionGroup(group) }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deletePermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, groupId: params.groupId }),
  useCase: deletePermissionGroup,
  present: () => ({ success: true as const }),
})
