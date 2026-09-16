import {
  createAccessRequestContract,
  listMyAccessRequestsContract,
} from '@/lib/api/contracts/access-requests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { accessRequestOperations } from '@/lib/permission-access-requests/application/operations'
import {
  createAccessRequest,
  listMyAccessRequests,
} from '@/lib/permission-access-requests/application/requests'

export const GET = defineInternalJsonRoute({
  contract: listMyAccessRequestsContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.listMine,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:read',
    config: { maxTokens: 120, refillRate: 60, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    scope: query,
    limit: query.limit,
    offset: query.offset,
    requestId: query.requestId,
  }),
  useCase: listMyAccessRequests,
})

export const POST = defineInternalJsonRoute({
  contract: createAccessRequestContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.create,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:write',
    config: { maxTokens: 10, refillRate: 5, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createAccessRequest,
  present: ({ request }) => ({ request }),
})
