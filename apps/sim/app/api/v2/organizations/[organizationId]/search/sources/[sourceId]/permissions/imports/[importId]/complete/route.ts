import { v2CompleteSourcePermissionImportContract } from '@/lib/api/contracts/v2/source-permission-imports'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { searchSourcePermissionOperations } from '@/lib/knowledge/application/operations'
import { completeSearchSourcePermissionImport } from '@/lib/knowledge/application/source-permission-imports'

export const POST = defineV2JsonRoute({
  contract: v2CompleteSourcePermissionImportContract,
  operation: searchSourcePermissionOperations.replace,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: completeSearchSourcePermissionImport,
  present: (data) => ({ data }),
})
