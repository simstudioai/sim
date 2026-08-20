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

/**
 * GET /api/v2/meta — Report the calling key's rollout cohort and lifecycle.
 *
 * The only route in `/api/v2` that is exempt from the rollout gate, and the
 * exemption is the point: every other endpoint answers a 404 that is
 * byte-identical to the unknown-path catch-all's, so a caller outside the cohort
 * cannot tell "not in the rollout" from "no such endpoint" and has nothing to
 * act on. Gating this endpoint too would give it the same ambiguity and leave
 * the question permanently unanswerable.
 *
 * Exempting it does not weaken that concealment. Authentication still runs
 * first, so the only fact disclosed is one about the caller's own credential,
 * disclosed to a caller who has already proved it holds that credential. It is
 * not a cross-tenant signal, not a resource-existence signal, and says nothing
 * about any other account. A request with no key, or a key for another account,
 * learns nothing it did not already hold.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetMetaContract,
  auth: v2ApiKeyAuth,
  operation: v2MetaOperations.read,
  gate: 'exempt',
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: readV2ApiCapabilities,
  present: ({ v2Enabled, keyType, expiresAt }) => ({
    data: { v2Enabled, keyType, expiresAt: expiresAt?.toISOString() ?? null },
  }),
})
