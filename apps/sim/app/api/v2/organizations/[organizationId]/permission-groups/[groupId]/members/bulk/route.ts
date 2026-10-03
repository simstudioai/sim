import { v2BulkAddPermissionGroupMembersContract } from '@/lib/api/contracts/v2/permission-groups'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2PermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { bulkAddPermissionGroupMembers } from '@/lib/permission-groups/application/use-cases'

export const POST = defineV2JsonRoute({
  contract: v2BulkAddPermissionGroupMembersContract,
  auth: v2ApiKeyAuth,
  operation: permissionGroupOperations.bulkAddMembers,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2PermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: bulkAddPermissionGroupMembers,
  present: ({ added, skipped }) => ({ data: { added, skipped } }),
})
