import { v2ListSecretsContract } from '@/lib/api/contracts/v2/secrets'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { secretOperations } from '@/lib/secrets/application/operations'
import { listSecretsUseCase } from '@/lib/secrets/application/use-cases'
import { toV2Secret } from '@/app/api/v2/secrets/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/secrets — List secret names and metadata without reading their values. */
export const GET = defineV2JsonRoute({
  contract: v2ListSecretsContract,
  operation: secretOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listSecretsUseCase,
  present: ({ secrets, userId }) => ({
    data: secrets.map((secret) => toV2Secret(secret, userId)),
    nextCursor: null,
  }),
})
