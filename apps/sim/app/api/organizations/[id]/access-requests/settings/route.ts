import {
  getAccessRequestSettingsContract,
  updateAccessRequestSettingsContract,
} from '@/lib/api/contracts/access-requests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import {
  getAccessRequestSettings,
  updateAccessRequestSettings,
} from '@/ee/access-requests/lib/application/requests'

export const GET = defineInternalJsonRoute({
  contract: getAccessRequestSettingsContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.getSettings,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:read',
    config: { maxTokens: 120, refillRate: 60, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getAccessRequestSettings,
})

export const PATCH = defineInternalJsonRoute({
  contract: updateAccessRequestSettingsContract,
  auth: internalSessionAuth,
  operation: accessRequestOperations.updateSettings,
  rateLimit: internalRateLimits.user({
    bucketName: 'access-requests:write',
    config: { maxTokens: 10, refillRate: 5, refillIntervalMs: 60000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: updateAccessRequestSettings,
})
