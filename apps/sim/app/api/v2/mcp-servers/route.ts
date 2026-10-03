import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2CreateMcpServerContract,
  v2ListMcpServersContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { mcpServerOperations } from '@/lib/mcp/application/operations'
import { createMcpServerUseCase, listMcpServersUseCase } from '@/lib/mcp/application/use-cases'
import { captureServerEvent } from '@/lib/posthog/server'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'
import { toV2McpServer } from '@/app/api/v2/mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which MCP servers, in which order, this list returns. */
function mcpServerCursorFilters(query: { workspaceId: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListMcpServersContract), {
    workspaceId: query.workspaceId,
    search: query.search,
  })
}

/** GET /api/v2/mcp-servers — List MCP servers in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListMcpServersContract,
  operation: mcpServerOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      mcpServerCursorFilters(query)
    ),
  }),
  useCase: listMcpServersUseCase,
  present: ({ servers, nextCursorKeys }, { query }) => ({
    data: servers.map(toV2McpServer),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      mcpServerCursorFilters(query)
    ),
  }),
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
    if (!isUserCredentialPrincipal(principal) || result.updated) return
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
