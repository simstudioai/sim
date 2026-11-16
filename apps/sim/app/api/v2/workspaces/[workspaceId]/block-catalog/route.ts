import { v2GetBlockCatalogContract } from '@/lib/api/contracts/v2/block-catalog'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { workflowCodeCatalogOperations } from '@/lib/workflows/code/catalog/operations'
import { readWorkflowCodeCatalog } from '@/lib/workflows/code/catalog/read-block-catalog'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workspaces/{workspaceId}/block-catalog — the workflow-SDK block catalog. The
 * response carries `ETag: "<hash>"`; a matching `If-None-Match` answers `304` with no body.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetBlockCatalogContract,
  operation: workflowCodeCatalogOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.workspaceId,
    ...(query.workflowId ? { workflowId: query.workflowId } : {}),
  }),
  useCase: readWorkflowCodeCatalog,
  entityTag: (catalog) => catalog.hash,
  present: (catalog) => ({ data: catalog }),
})
