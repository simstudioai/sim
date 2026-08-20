import { v2ListEnrichmentsContract } from '@/lib/api/contracts/v2/catalog'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { listCatalogEnrichments } from '@/lib/catalog/application/list-enrichments'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/enrichments — List every code-defined table enrichment. */
export const GET = defineV2JsonRoute({
  contract: v2ListEnrichmentsContract,
  operation: catalogOperations.listEnrichments,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listCatalogEnrichments,
  present: ({ enrichments }) => ({ data: enrichments, nextCursor: null }),
})
