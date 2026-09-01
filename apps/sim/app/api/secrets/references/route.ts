import { getSecretReferencesContract } from '@/lib/api/contracts/secrets'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { secretOperations } from '@/lib/secrets/application/operations'
import { listSecretReferencesUseCase } from '@/lib/secrets/application/use-cases'

/** GET /api/secrets/references — where one secret is wired in, for the credential detail panel. */
export const GET = defineInternalJsonRoute({
  contract: getSecretReferencesContract,
  auth: internalSessionAuth,
  operation: secretOperations.references,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    name: query.name,
  }),
  useCase: listSecretReferencesUseCase,
  /** The scan's shape is already the wire shape — nothing to project or serialize. */
  present: (scan) => scan,
})
