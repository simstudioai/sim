import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { updateMcpServerBodySchema } from '@/lib/api/contracts/mcp'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
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

        const rawBody = getParsedBody(request) ?? (await request.json())
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

        // Remove workspaceId from body to prevent it from being updated
        const { workspaceId: _, ...updateData } = body

        const result = await performUpdateMcpServer({
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          serverId,
          name: updateData.name,
          description: updateData.description,
          transport: updateData.transport,
          url: updateData.url,
          headers: updateData.headers,
          timeout: updateData.timeout,
          retries: updateData.retries,
          enabled: updateData.enabled,
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

        return createMcpSuccessResponse({ server: updatedServer })
      } catch (error) {
        logger.error(`[${requestId}] Error updating MCP server:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to update MCP server', 500)
      }
    }
  )
)
