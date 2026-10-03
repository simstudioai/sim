import { discoverAccessRequestsContract } from '@/lib/api/contracts/access-requests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import { discoverAccessRequests } from '@/ee/access-requests/lib/application/requests'

export const GET = defineInternalJsonRoute({
  contract: discoverAccessRequestsContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.discover,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:read',
    config: { maxTokens: 120, refillRate: 60, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: discoverAccessRequests,
})
