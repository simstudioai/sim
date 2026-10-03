import { getSecretUsageContract } from '@/lib/api/contracts/secrets'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { secretOperations } from '@/lib/secrets/application/operations'
import { listSecretUsageUseCase } from '@/lib/secrets/application/use-cases'

/** GET /api/secrets/usage — One secret's usage trail, for the credential detail panel. */
export const GET = defineInternalJsonRoute({
  contract: getSecretUsageContract,
  auth: internalSessionAuth,
  operation: secretOperations.usage,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    name: query.name,
    scope: query.scope,
    limit: query.limit,
  }),
  useCase: listSecretUsageUseCase,
  present: ({ entries }) => ({
    entries: entries.map((entry) => ({
      ...entry,
      lastUsedAt: entry.lastUsedAt.toISOString(),
    })),
  }),
})
