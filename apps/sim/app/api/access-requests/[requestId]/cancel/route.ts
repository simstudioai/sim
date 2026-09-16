import { cancelAccessRequestContract } from '@/lib/api/contracts/access-requests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { accessRequestOperations } from '@/lib/permission-access-requests/application/operations'
import { cancelAccessRequest } from '@/lib/permission-access-requests/application/requests'

export const POST = defineInternalJsonRoute({
  contract: cancelAccessRequestContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.cancel,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:write',
    config: { maxTokens: 10, refillRate: 5, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ requestId: params.requestId, scope: body.scope }),
  useCase: cancelAccessRequest,
  present: ({ request }) => ({ request }),
})
