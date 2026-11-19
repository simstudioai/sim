import { v2PutSourcePermissionImportPartContract } from '@/lib/api/contracts/v2/source-permission-imports'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { searchSourcePermissionOperations } from '@/lib/knowledge/application/operations'
import { putSearchSourcePermissionImportPart } from '@/lib/knowledge/application/source-permission-imports'

export const PUT = defineV2JsonRoute({
  contract: v2PutSourcePermissionImportPartContract,
  operation: searchSourcePermissionOperations.replace,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: putSearchSourcePermissionImportPart,
  present: (data) => ({ data }),
})
