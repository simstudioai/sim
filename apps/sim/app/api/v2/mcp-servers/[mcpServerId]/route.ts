import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2DeleteMcpServerContract,
  v2GetMcpServerContract,
  v2UpdateMcpServerContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import {
  deleteMcpServerUseCase,
  getMcpServerUseCase,
  updateMcpServerUseCase,
} from '@/lib/mcp/application/use-cases'
import { captureServerEvent } from '@/lib/posthog/server'
import { mcpServerResourceErrorPolicy, toV2McpServer } from '@/app/api/v2/mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/mcp-servers/[mcpServerId] — Fetch a single MCP server. */
export const GET = defineV2JsonRoute({
  contract: v2GetMcpServerContract,
  operation: mcpServerOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: mcpServerResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    serverId: params.mcpServerId,
  }),
  useCase: getMcpServerUseCase,
  present: ({ server }) => ({ data: toV2McpServer(server) }),
})

/** PATCH /api/v2/mcp-servers/[mcpServerId] — Update an MCP server's configuration. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateMcpServerContract,
  operation: mcpServerOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: mcpServerResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    serverId: params.mcpServerId,
    source: 'api' as const,
  }),
  useCase: updateMcpServerUseCase,
  present: ({ server }) => ({ data: toV2McpServer(server) }),
})

/** DELETE /api/v2/mcp-servers/[mcpServerId] — Remove an MCP server from the workspace. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteMcpServerContract,
  operation: mcpServerOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: mcpServerResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: query.workspaceId,
    serverId: params.mcpServerId,
    source: 'api' as const,
  }),
  useCase: deleteMcpServerUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'mcp_server_disconnected',
      {
        workspace_id: input.workspaceId,
        server_name: result.server.name,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ server }) => ({ data: { id: server.id, deleted: true as const } }),
})
