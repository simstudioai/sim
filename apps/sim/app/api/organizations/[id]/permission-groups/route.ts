import {
  createPermissionGroupContract,
  listPermissionGroupsContract,
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
  createPermissionGroup,
  listPermissionGroups,
} from '@/lib/permission-groups/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: listPermissionGroupsContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listPermissionGroups,
  present: ({ data }) => ({ permissionGroups: data.map(presentPermissionGroup) }),
})

export const POST = defineInternalJsonRoute({
  contract: createPermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, changes: body }),
  useCase: createPermissionGroup,
  present: (group) => ({ permissionGroup: presentPermissionGroup(group) }),
})
