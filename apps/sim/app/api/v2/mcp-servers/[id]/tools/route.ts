import { v2ListMcpServerToolsContract } from '@/lib/api/contracts/v2/mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import { v2McpToolDiscoveryErrorPolicy } from '@/app/api/v2/mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/mcp-servers/[id]/tools — List the tools a registered MCP server exposes.
 *
 * The path segment is static, so it can never shadow a server id: ids are minted
 * as `mcp-<hash>` from the workspace and endpoint URL, and the registration
 * contract requires a URL.
 *
 * Discovery is not a safe read: it opens a live connection to the registered
 * endpoint and records the outcome on the server row. Next aliases `HEAD` onto
 * `GET`, and RFC 9110 §9.2.1 defines `HEAD` as safe, so this route declares
 * itself not head-safe. A `HEAD` is admitted, parsed, and authorized through
 * `discoverMcpServerToolsUseCase.authorize` — the same principal-kind check,
 * server resolution, and workspace access check the `GET` performs — then
 * answered bodiless without connecting or writing. Without the not-head-safe
 * declaration an uptime monitor walking the documented URL list would drive
 * outbound third-party traffic and mutate rows on every probe; without the
 * authorization step the probe would instead confirm that a server id exists in
 * a workspace the caller cannot read.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListMcpServerToolsContract,
  operation: mcpServerOperations.discoverTools,
  auth: v2ApiKeyAuth,
  headSafe: false,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2McpToolDiscoveryErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    serverId: params.id,
    refresh: query.refresh,
  }),
  useCase: discoverMcpServerToolsUseCase,
  present: ({ tools }) => ({ data: tools, nextCursor: null }),
})
