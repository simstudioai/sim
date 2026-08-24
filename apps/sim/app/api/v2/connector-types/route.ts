import { v2ListConnectorTypesContract } from '@/lib/api/contracts/v2/catalog'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { listCatalogConnectorTypes } from '@/lib/catalog/application/list-connector-types'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/connector-types — List every knowledge-base connector type. */
export const GET = defineV2JsonRoute({
  contract: v2ListConnectorTypesContract,
  operation: catalogOperations.listConnectorTypes,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listCatalogConnectorTypes,
  present: ({ connectorTypes }) => ({ data: connectorTypes, nextCursor: null }),
})
