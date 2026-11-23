import { v2CreateSourcePermissionImportContract } from '@/lib/api/contracts/v2/source-permission-imports'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { searchSourcePermissionOperations } from '@/lib/knowledge/application/operations'
import { createSearchSourcePermissionImport } from '@/lib/knowledge/application/source-permission-imports'

export const POST = defineV2JsonRoute({
  contract: v2CreateSourcePermissionImportContract,
  operation: searchSourcePermissionOperations.replace,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, manifest: body }),
  useCase: createSearchSourcePermissionImport,
  present: (data) => ({ data }),
})
