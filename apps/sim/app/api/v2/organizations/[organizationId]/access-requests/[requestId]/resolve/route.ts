import { v2ResolveOrganizationAccessRequestContract } from '@/lib/api/contracts/v2/access-requests'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import { resolveAccessRequest } from '@/ee/access-requests/lib/application/review'

export const POST = defineV2JsonRoute({
  contract: v2ResolveOrganizationAccessRequestContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.resolve,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, decision: body }),
  useCase: resolveAccessRequest,
  present: ({ request }) => ({ data: request }),
})
