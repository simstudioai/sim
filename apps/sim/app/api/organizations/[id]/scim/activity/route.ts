import { listScimActivityContract } from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listScimActivity } from '@/ee/scim/lib/application/admin/connection'

/** Recent provisioning requests, so a failing sync can be diagnosed from Sim. */
export const GET = defineInternalJsonRoute({
  contract: listScimActivityContract,
  auth: internalSessionAuth,
  operation: listScimActivity.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated organization settings read, admission unchanged from its siblings.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  }),
  useCase: listScimActivity,
})
