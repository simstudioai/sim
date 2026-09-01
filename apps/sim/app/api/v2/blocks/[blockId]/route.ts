import { v2GetBlockContract } from '@/lib/api/contracts/v2/catalog'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { getCatalogBlock } from '@/lib/catalog/application/get-block'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/blocks/{blockId} — Read one block's full configuration shape. */
export const GET = defineV2JsonRoute({
  contract: v2GetBlockContract,
  operation: catalogOperations.readBlock,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    blockId: params.blockId,
  }),
  useCase: getCatalogBlock,
  present: ({ block }) => ({ data: block }),
})
