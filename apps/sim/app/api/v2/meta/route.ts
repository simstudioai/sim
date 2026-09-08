import { v2MetaOperations } from '@/lib/api/application/operations'
import { readV2ApiCapabilities } from '@/lib/api/application/read-v2-api-capabilities'
import { v2GetMetaContract } from '@/lib/api/contracts/v2/meta'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/meta — Report the calling credential's API availability and lifecycle. */
export const GET = defineV2JsonRoute({
  contract: v2GetMetaContract,
  auth: v2ApiKeyAuth,
  operation: v2MetaOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: (_request, credential) => ({
    keyType: credential.keyType,
    expiresAt: credential.keyExpiresAt,
  }),
  useCase: readV2ApiCapabilities,
  present: ({ v2Enabled, keyType, expiresAt }) => ({
    data: { v2Enabled, keyType, expiresAt: expiresAt?.toISOString() ?? null },
  }),
})
