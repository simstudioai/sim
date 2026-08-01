import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CreateMcpServerContract,
  v2ListMcpServersContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performCreateMcpServer } from '@/lib/mcp/orchestration'
import {
  getMcpServerIdState,
  getWorkspaceMcpServer,
  listWorkspaceMcpServers,
} from '@/lib/mcp/queries'
import { generateMcpServerId } from '@/lib/mcp/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toV2McpServer, v2McpOrchestrationError } from '@/app/api/v2/mcp-servers/utils'

const logger = createLogger('V2McpServersAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/mcp-servers — List MCP servers in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'mcp-servers')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListMcpServersContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const rows = await listWorkspaceMcpServers({ workspaceId })

    // The per-workspace server set is small and bounded → a single full page.
    return v2CursorList(rows.map(toV2McpServer), null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing MCP servers`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/mcp-servers — Register a new MCP server. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'mcp-servers')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateMcpServerContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, ...body } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    /**
     * The server id is a deterministic hash of workspace + normalized URL, and
     * `performCreateMcpServer` upserts onto it — a second registration of the
     * same URL silently overwrites the first. The internal surface and the
     * copilot rely on that; a public create must not, so the collision is
     * detected here, before the lib is given a chance to clobber the row.
     *
     * Only a *live* row is a conflict. A soft-deleted one is revived by the lib
     * rather than inserted alongside, and reporting it as a duplicate would
     * strand that URL for good: the detail routes resolve live rows only, so it
     * could be neither fetched, patched, nor re-created.
     */
    const serverId = generateMcpServerId(workspaceId, body.url)
    const idState = await getMcpServerIdState({ workspaceId, serverId })
    if (idState && !idState.deleted) {
      return v2Error(
        'CONFLICT',
        'An MCP server with this URL already exists in this workspace. Update it with PATCH /api/v2/mcp-servers/{id}.'
      )
    }
    const revivingSoftDeleted = idState?.deleted === true

    const result = await performCreateMcpServer({
      workspaceId,
      userId,
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

    if (!result.success || !result.serverId) {
      return v2McpOrchestrationError(result.errorCode, result.error ?? 'Failed to register server')
    }

    /**
     * `updated` means the lib wrote onto an existing row. Reviving the
     * soft-deleted row we already saw is the intended outcome; otherwise a
     * concurrent create won the id race between the check above and the write.
     */
    if (result.updated && !revivingSoftDeleted) {
      return v2Error('CONFLICT', 'An MCP server with this URL already exists in this workspace.')
    }

    const created = await getWorkspaceMcpServer({ workspaceId, serverId: result.serverId })
    if (!created) return v2Error('INTERNAL_ERROR', 'Internal server error')

    return v2Data({ mcpServer: toV2McpServer(created) }, { rateLimit, status: 201 })
  } catch (error) {
    logger.error(`[${requestId}] Error creating MCP server`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
