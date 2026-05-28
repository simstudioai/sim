import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { updateMcpServerBodySchema } from '@/lib/api/contracts/mcp'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  mcpBodyReadErrorResponse,
  readMcpJsonBodyWithLimit,
  withMcpAuth,
} from '@/lib/mcp/middleware'
import { performUpdateMcpServer } from '@/lib/mcp/orchestration'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  mcpOrchestrationStatus,
} from '@/lib/mcp/utils'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server in the workspace (requires write or admin permission)
 */
export const PATCH = withRouteHandler(
  withMcpAuth<{ id: string }>('write')(
    async (
      request: NextRequest,
      { userId, userName, userEmail, workspaceId, requestId },
      { params }
    ) => {
      try {
        const { id: serverId } = await params

        const rawBody = await readMcpJsonBodyWithLimit(request)
        const parsedBody = updateMcpServerBodySchema.safeParse(rawBody)

        if (!parsedBody.success) {
          return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
        }

        const body = parsedBody.data

        logger.info(
          `[${requestId}] Updating MCP server: ${serverId} in workspace: ${workspaceId}`,
          {
            userId,
            updates: Object.keys(body).filter((k) => k !== 'workspaceId'),
          }
        )

        const result = await performUpdateMcpServer({
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          serverId,
          name: body.name,
          description: body.description,
          transport: body.transport,
          url: body.url,
          headers: body.headers,
          timeout: body.timeout,
          retries: body.retries,
          enabled: body.enabled,
          authType: body.authType,
          oauthClientId: body.oauthClientId || null,
          oauthClientIdProvided: body.oauthClientId !== undefined,
          oauthClientSecret: body.oauthClientSecret,
          oauthClientSecretProvided: body.oauthClientSecret !== undefined,
          request,
        })
        if (!result.success || !result.server) {
          return createMcpErrorResponse(
            new Error('Server not found or access denied'),
            result.error || 'Server not found',
            mcpOrchestrationStatus(result.errorCode)
          )
        }
        const updatedServer = result.server

        logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)

        const { oauthClientSecret: _secret, ...rest } = updatedServer
        return createMcpSuccessResponse({
          server: { ...rest, hasOauthClientSecret: !!_secret },
        })
      } catch (error) {
        const bodyErrorResponse = mcpBodyReadErrorResponse(error, request)
        if (bodyErrorResponse) return bodyErrorResponse
        logger.error(`[${requestId}] Error updating MCP server:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to update MCP server', 500)
      }
    }
  )
)
