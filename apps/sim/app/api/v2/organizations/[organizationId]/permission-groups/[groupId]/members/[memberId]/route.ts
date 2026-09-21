import { v2RemovePermissionGroupMemberContract } from '@/lib/api/contracts/v2/permission-groups'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2PermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { removePermissionGroupMember } from '@/lib/permission-groups/application/use-cases'

export const DELETE = defineV2JsonRoute({
  contract: v2RemovePermissionGroupMemberContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.removeMember,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: removePermissionGroupMember,
  present: ({ member }) => ({ data: { id: member.id, deleted: true as const } }),
})
