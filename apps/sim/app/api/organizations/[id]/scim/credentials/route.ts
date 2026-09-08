import { issueScimCredentialContract } from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { issueScimCredential } from '@/ee/scim/lib/application/admin/credentials'

/** Issues a bearer credential. The secret is returned once and never stored. */
export const POST = defineInternalJsonRoute({
  contract: issueScimCredentialContract,
  auth: internalSessionAuth,
  operation: issueScimCredential.operation,
  rateLimit: internalRateLimits.user({
    bucketName: 'scim-credential-issue',
    config: { maxTokens: 10, refillRate: 5, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    ...(body.expiresInDays !== undefined ? { expiresInDays: body.expiresInDays } : {}),
  }),
  useCase: issueScimCredential,
  present: ({ secret, credential }) => ({ secret, credential }),
})
