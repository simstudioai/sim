import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpServerPublishAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
}

/**
 * POST - Publish a workflow MCP server (make it accessible via OAuth)
 */
export const POST = withMcpAuth<RouteParams>('admin')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params

      logger.info(`[${requestId}] Publishing workflow MCP server: ${serverId}`)

      const [existingServer] = await db
        .select({ id: workflowMcpServer.id, isPublished: workflowMcpServer.isPublished })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!existingServer) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      if (existingServer.isPublished) {
        return createMcpErrorResponse(
          new Error('Server is already published'),
          'Server is already published',
          400
        )
      }

      // Check if server has at least one tool
      const tools = await db
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(eq(workflowMcpTool.serverId, serverId))
        .limit(1)

      if (tools.length === 0) {
        return createMcpErrorResponse(
          new Error('Cannot publish server without any tools. Add at least one workflow as a tool first.'),
          'Server has no tools',
          400
        )
      }

      const [updatedServer] = await db
        .update(workflowMcpServer)
        .set({
          isPublished: true,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowMcpServer.id, serverId))
        .returning()

      const baseUrl = getBaseUrl()
      const mcpServerUrl = `${baseUrl}/api/mcp/serve/${serverId}/sse`

      logger.info(`[${requestId}] Successfully published workflow MCP server: ${serverId}`)

      return createMcpSuccessResponse({
        server: updatedServer,
        mcpServerUrl,
        message: 'Server published successfully. External MCP clients can now connect using OAuth.',
      })
    } catch (error) {
      logger.error(`[${requestId}] Error publishing workflow MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to publish workflow MCP server'),
        'Failed to publish workflow MCP server',
        500
      )
    }
  }
)

/**
 * DELETE - Unpublish a workflow MCP server
 */
export const DELETE = withMcpAuth<RouteParams>('admin')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params

      logger.info(`[${requestId}] Unpublishing workflow MCP server: ${serverId}`)

      const [existingServer] = await db
        .select({ id: workflowMcpServer.id, isPublished: workflowMcpServer.isPublished })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!existingServer) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      if (!existingServer.isPublished) {
        return createMcpErrorResponse(
          new Error('Server is not published'),
          'Server is not published',
          400
        )
      }

      const [updatedServer] = await db
        .update(workflowMcpServer)
        .set({
          isPublished: false,
          updatedAt: new Date(),
        })
        .where(eq(workflowMcpServer.id, serverId))
        .returning()

      logger.info(`[${requestId}] Successfully unpublished workflow MCP server: ${serverId}`)

      return createMcpSuccessResponse({
        server: updatedServer,
        message: 'Server unpublished successfully. External MCP clients can no longer connect.',
      })
    } catch (error) {
      logger.error(`[${requestId}] Error unpublishing workflow MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to unpublish workflow MCP server'),
        'Failed to unpublish workflow MCP server',
        500
      )
    }
  }
)
