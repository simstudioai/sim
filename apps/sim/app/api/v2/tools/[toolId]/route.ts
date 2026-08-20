import { v2GetToolContract } from '@/lib/api/contracts/v2/catalog'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { getCatalogTool } from '@/lib/catalog/application/get-tool'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/tools/{toolId} — Read one built-in tool's parameters and outputs. */
export const GET = defineV2JsonRoute({
  contract: v2GetToolContract,
  operation: catalogOperations.readTool,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    toolId: params.toolId,
  }),
  useCase: getCatalogTool,
  present: ({ tool }) => ({ data: tool }),
})
