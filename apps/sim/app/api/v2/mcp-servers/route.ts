import {
  v2CreateMcpServerContract,
  v2ListMcpServersContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { createMcpServerUseCase, listMcpServersUseCase } from '@/lib/mcp/application/use-cases'
import { captureServerEvent } from '@/lib/posthog/server'
import { toV2McpServer } from '@/app/api/v2/mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/mcp-servers — List MCP servers in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListMcpServersContract,
  operation: mcpServerOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listMcpServersUseCase,
  present: ({ servers }) => ({ data: servers.map(toV2McpServer), nextCursor: null }),
})

/** POST /api/v2/mcp-servers — Register a new MCP server. */
export const POST = defineV2JsonRoute({
  contract: v2CreateMcpServerContract,
  operation: mcpServerOperations.create,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => ({ ...body, source: 'api' as const }),
  useCase: createMcpServerUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (principal.kind !== 'personal_api_key' || result.updated) return
    captureServerEvent(
      principal.userId,
      'mcp_server_connected',
      {
        workspace_id: input.workspaceId,
        server_name: result.server.name,
        transport: result.server.transport,
      },
      {
        groups: { workspace: input.workspaceId },
        setOnce: { first_mcp_connected_at: new Date().toISOString() },
      }
    )
  },
  present: ({ server }) => ({ data: toV2McpServer(server) }),
})
