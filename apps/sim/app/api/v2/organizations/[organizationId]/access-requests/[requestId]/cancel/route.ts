import { v2CancelOrganizationAccessRequestContract } from '@/lib/api/contracts/v2/access-requests'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import { cancelAccessRequest } from '@/ee/access-requests/lib/application/requests'

export const POST = defineV2JsonRoute({
  contract: v2CancelOrganizationAccessRequestContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.cancel,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params }) => ({
    requestId: params.requestId,
    scope: { kind: 'organization' as const, organizationId: params.organizationId },
  }),
  useCase: cancelAccessRequest,
  present: ({ request }) => ({ data: request }),
})
