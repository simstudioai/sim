import { v2GetSourceCatalogContract } from '@/lib/api/contracts/v2/source-catalog'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readSourceCatalog } from '@/lib/workflows/application/read-source-catalog'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workspaces/{workspaceId}/workflows/source/catalog — the source catalog. The
 * response carries `ETag: "<hash>"`; a matching `If-None-Match` answers `304` with no body.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetSourceCatalogContract,
  operation: workflowOperations.readSourceCatalog,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.workspaceId,
    ...(query.workflowId ? { workflowId: query.workflowId } : {}),
  }),
  useCase: readSourceCatalog,
  entityTag: (catalog) => catalog.hash,
  present: (catalog) => ({ data: catalog }),
})
