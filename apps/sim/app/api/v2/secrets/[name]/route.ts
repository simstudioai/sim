import { v2DeleteSecretContract, v2SetSecretContract } from '@/lib/api/contracts/v2/secrets'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { secretOperations } from '@/lib/secrets/application/operations'
import { deleteSecretUseCase, setSecretUseCase } from '@/lib/secrets/application/use-cases'
import { toV2Secret } from '@/app/api/v2/secrets/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** PUT /api/v2/secrets/[name] — Create or replace a write-only secret value. */
export const PUT = defineV2JsonRoute({
  contract: v2SetSecretContract,
  operation: secretOperations.set,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  /**
   * Normalizes a blank description to an explicit clear here rather than in the
   * contract: a Zod `.transform()` on any property drops the whole request
   * schema's OpenAPI examples, silently removing them from the published docs.
   */
  mapInput: ({ params, body }) => ({
    ...body,
    name: params.name,
    ...(body.description === '' ? { description: null } : {}),
  }),
  useCase: setSecretUseCase,
  statusForResult: ({ created }) => (created ? 201 : 200),
  present: ({ secret, userId }) => ({ data: toV2Secret(secret, userId) }),
})

/** DELETE /api/v2/secrets/[name] — Delete a secret without reading its value. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteSecretContract,
  operation: secretOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ ...query, name: params.name }),
  useCase: deleteSecretUseCase,
  present: ({ name, scope }) => ({ data: { name, scope, deleted: true as const } }),
})
