import { reconcileScimConnectionContract } from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { reconcileScimConnection } from '@/ee/scim/lib/application/admin/connection'

/**
 * Re-applies every group mapping to every provisioned user.
 *
 * Idempotent, so an administrator can run it after changing mappings without
 * waiting for the scheduled pass.
 */
export const POST = defineInternalJsonRoute({
  contract: reconcileScimConnectionContract,
  auth: internalSessionAuth,
  operation: reconcileScimConnection.operation,
  rateLimit: internalRateLimits.user({
    bucketName: 'scim-reconcile',
    config: { maxTokens: 5, refillRate: 2, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: reconcileScimConnection,
})
