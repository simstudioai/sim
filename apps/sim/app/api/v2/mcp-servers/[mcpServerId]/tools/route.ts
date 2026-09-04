import { v2ListMcpServerToolsContract } from '@/lib/api/contracts/v2/mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import { v2McpToolDiscoveryErrorPolicy } from '@/app/api/v2/mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/mcp-servers/[mcpServerId]/tools — List the tools a registered MCP server exposes.
 *
 * The path segment is static, so it can never shadow a server id: ids are minted
 * as `mcp-<hash>` from the workspace and endpoint URL, and the registration
 * contract requires a URL.
 *
 * `headSafe: false` because discovery opens a live connection to the registered
 * endpoint and records the outcome on the server row.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListMcpServerToolsContract,
  operation: mcpServerOperations.discoverTools,
  auth: v2ApiKeyAuth,
  headSafe: false,
  write: true,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2McpToolDiscoveryErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    serverId: params.mcpServerId,
    refresh: query.refresh,
  }),
  useCase: discoverMcpServerToolsUseCase,
  present: ({ tools }) => ({ data: tools, nextCursor: null }),
})
