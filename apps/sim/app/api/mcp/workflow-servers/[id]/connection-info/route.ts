import { db } from '@sim/db'
import { workflowMcpServer } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { getMcpServerConnectionInfo } from '@/lib/mcp/serve-auth'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpConnectionInfoAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
}

/**
 * GET - Get connection info for an MCP server
 */
export const GET = withMcpAuth<RouteParams>('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params

      logger.info(`[${requestId}] Getting connection info for server: ${serverId}`)

      const [server] = await db
        .select({
          id: workflowMcpServer.id,
          name: workflowMcpServer.name,
          isPublished: workflowMcpServer.isPublished,
        })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      if (!server.isPublished) {
        return createMcpErrorResponse(
          new Error('Server must be published to get connection info'),
          'Server not published',
          400
        )
      }

      const baseUrl = getBaseUrl()
      const connectionInfo = getMcpServerConnectionInfo(serverId, server.name, baseUrl)

      return createMcpSuccessResponse({
        serverId,
        serverName: server.name,
        ...connectionInfo,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error getting connection info:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to get connection info'),
        'Failed to get connection info',
        500
      )
    }
  }
)
