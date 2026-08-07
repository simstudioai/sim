import {
  v2DeleteMcpServerContract,
  v2GetMcpServerContract,
  v2UpdateMcpServerContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { performDeleteMcpServer, performUpdateMcpServer } from '@/lib/mcp/orchestration'
import { getWorkspaceMcpServer } from '@/lib/mcp/queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { toV2McpServer, v2McpOrchestrationError } from '@/app/api/v2/mcp-servers/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/mcp-servers/[id] — Fetch a single MCP server. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetMcpServerContract,
  rateLimitEndpoint: 'mcp-server-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const server = await getWorkspaceMcpServer({ workspaceId, serverId: id })
    if (!server) return v2Error('NOT_FOUND', 'MCP server not found')

    return v2Data({ mcpServer: toV2McpServer(server) }, { rateLimit })
  },
})

/** PATCH /api/v2/mcp-servers/[id] — Update an MCP server's configuration. */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateMcpServerContract,
  rateLimitEndpoint: 'mcp-server-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId, ...body } = input.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    /**
     * A server's id is the hash of its workspace + URL, and this surface promises
     * that identity. The lib will happily move `url` while the id keeps hashing
     * the old one, which both breaks that promise and defeats the duplicate
     * check on create (id-keyed, so it would not see the moved URL) — leaving two
     * rows on one URL. Re-pointing a server at a different URL is a new server.
     */
    if (body.url !== undefined) {
      const current = await getWorkspaceMcpServer({ workspaceId, serverId: id })
      if (!current) return v2Error('NOT_FOUND', 'MCP server not found')
      if (current.url !== body.url) {
        return v2Error(
          'BAD_REQUEST',
          'url cannot be changed: an MCP server’s id is derived from its URL. Delete this server and create one at the new URL.'
        )
      }
    }

    const result = await performUpdateMcpServer({
      workspaceId,
      userId,
      serverId: id,
      name: body.name,
      description: body.description,
      transport: body.transport,
      url: body.url,
      headers: body.headers,
      timeout: body.timeout,
      retries: body.retries,
      enabled: body.enabled,
      authType: body.authType,
      oauthClientId: body.oauthClientId ?? null,
      oauthClientIdProvided: body.oauthClientId !== undefined,
      oauthClientSecret: body.oauthClientSecret,
      oauthClientSecretProvided: body.oauthClientSecret !== undefined,
      request,
    })

    if (!result.success || !result.server) {
      return v2McpOrchestrationError(result.errorCode, result.error ?? 'Failed to update server')
    }

    return v2Data({ mcpServer: toV2McpServer(result.server) }, { rateLimit })
  },
})

/** DELETE /api/v2/mcp-servers/[id] — Remove an MCP server from the workspace. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteMcpServerContract,
  rateLimitEndpoint: 'mcp-server-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteMcpServer({ workspaceId, userId, serverId: id, request })
    if (!result.success) {
      return v2McpOrchestrationError(result.errorCode, result.error ?? 'Failed to delete server')
    }

    return v2Data({ id, deleted: true as const }, { rateLimit })
  },
})
