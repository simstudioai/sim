import { bulkAddPermissionGroupMembersContract } from '@/lib/api/contracts/permission-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { bulkAddPermissionGroupMembers } from '@/lib/permission-groups/application/use-cases'

export const POST = defineInternalJsonRoute({
  contract: bulkAddPermissionGroupMembersContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.bulkAddMembers,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, groupId: params.groupId, ...body }),
  useCase: bulkAddPermissionGroupMembers,
  present: ({ added, skipped }) => ({ added, skipped }),
})
