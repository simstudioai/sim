import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteMcpServerContract,
  v2GetMcpServerContract,
  v2UpdateMcpServerContract,
} from '@/lib/api/contracts/v2/mcp-servers'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performDeleteMcpServer, performUpdateMcpServer } from '@/lib/mcp/orchestration'
import { getWorkspaceMcpServer } from '@/lib/mcp/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toV2McpServer, v2McpOrchestrationError } from '@/app/api/v2/mcp-servers/utils'

const logger = createLogger('V2McpServerDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/mcp-servers/[id] — Fetch a single MCP server. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'mcp-server-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetMcpServerContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const server = await getWorkspaceMcpServer({ workspaceId, serverId: id })
    if (!server) return v2Error('NOT_FOUND', 'MCP server not found')

    return v2Data({ mcpServer: toV2McpServer(server) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching MCP server`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/mcp-servers/[id] — Update an MCP server's configuration. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'mcp-server-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateMcpServerContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, ...body } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

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
  } catch (error) {
    logger.error(`[${requestId}] Error updating MCP server`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/mcp-servers/[id] — Remove an MCP server from the workspace. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'mcp-server-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteMcpServerContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteMcpServer({ workspaceId, userId, serverId: id, request })
    if (!result.success) {
      return v2McpOrchestrationError(result.errorCode, result.error ?? 'Failed to delete server')
    }

    return v2Data({ id, deleted: true as const }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting MCP server`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
