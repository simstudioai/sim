import { previewAccessRequestContract } from '@/lib/api/contracts/access-requests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { accessRequestOperations } from '@/lib/permission-access-requests/application/operations'
import { previewAccessRequest } from '@/lib/permission-access-requests/application/review'

export const GET = defineInternalJsonRoute({
  contract: previewAccessRequestContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.preview,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:read',
    config: { maxTokens: 120, refillRate: 60, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, requestId: params.requestId }),
  useCase: previewAccessRequest,
})
