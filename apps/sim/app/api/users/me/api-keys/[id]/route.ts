import { deletePersonalApiKeyContract } from '@/lib/api/contracts/api-keys'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  personalApiKeyOperations,
  revokePersonalApiKey,
} from '@/lib/api-key/application/personal-api-keys'

export const DELETE = defineInternalJsonRoute({
  contract: deletePersonalApiKeyContract,
  auth: internalSessionAuth,
  operation: personalApiKeyOperations.revoke,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing account credential revocation admission',
  }),
  errorPolicy: {
    project: internalOrchestrationErrorPolicy.project,
    unhandled: () => internalErrorResponse(500, { error: 'Failed to delete API key' }),
  },
  mapInput: ({ params }) => ({ keyId: params.id }),
  useCase: revokePersonalApiKey,
})
