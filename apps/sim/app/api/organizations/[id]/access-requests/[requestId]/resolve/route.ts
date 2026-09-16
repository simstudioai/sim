import { resolveAccessRequestContract } from '@/lib/api/contracts/access-requests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { accessRequestOperations } from '@/lib/permission-access-requests/application/operations'
import { resolveAccessRequest } from '@/lib/permission-access-requests/application/review'

export const POST = defineInternalJsonRoute({
  contract: resolveAccessRequestContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.resolve,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:write',
    config: { maxTokens: 10, refillRate: 5, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    requestId: params.requestId,
    decision: body,
  }),
  useCase: resolveAccessRequest,
  present: ({ request }) => ({ request }),
})
