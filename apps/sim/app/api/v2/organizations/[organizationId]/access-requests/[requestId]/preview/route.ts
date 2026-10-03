import { v2PreviewOrganizationAccessRequestContract } from '@/lib/api/contracts/v2/access-requests'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2AccessRequestErrorPolicy } from '@/lib/api/server/routes/access-requests'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import { previewAccessRequest } from '@/ee/access-requests/lib/application/review'

export const GET = defineV2JsonRoute({
  contract: v2PreviewOrganizationAccessRequestContract,
  auth: v2ApiKeyAuth,
  operation: accessRequestOperations.preview,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2AccessRequestErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: previewAccessRequest,
  present: (preview) => ({ data: preview }),
})
