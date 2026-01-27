import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpServerAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
}

/**
 * GET - Get a specific workflow MCP server with its tools
 */
export const GET = withMcpAuth<RouteParams>('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params

      logger.info(`[${requestId}] Getting workflow MCP server: ${serverId}`)

      const [server] = await db
        .select({
          id: workflowMcpServer.id,
          workspaceId: workflowMcpServer.workspaceId,
          createdBy: workflowMcpServer.createdBy,
          name: workflowMcpServer.name,
          description: workflowMcpServer.description,
          isPublic: workflowMcpServer.isPublic,
          createdAt: workflowMcpServer.createdAt,
          updatedAt: workflowMcpServer.updatedAt,
        })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const tools = await db
        .select()
        .from(workflowMcpTool)
        .where(eq(workflowMcpTool.serverId, serverId))

      logger.info(
        `[${requestId}] Found workflow MCP server: ${server.name} with ${tools.length} tools`
      )

      return createMcpSuccessResponse({ server, tools })
    } catch (error) {
      logger.error(`[${requestId}] Error getting workflow MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to get workflow MCP server'),
        'Failed to get workflow MCP server',
        500
      )
    }
  }
)

/**
 * PATCH - Update a workflow MCP server
 */
export const PATCH = withMcpAuth<RouteParams>('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Updating workflow MCP server: ${serverId}`)

      const [existingServer] = await db
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!existingServer) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (body.name !== undefined) {
        updateData.name = body.name.trim()
      }
      if (body.description !== undefined) {
        updateData.description = body.description?.trim() || null
      }
      if (body.isPublic !== undefined) {
        updateData.isPublic = body.isPublic
      }

      const [updatedServer] = await db
        .update(workflowMcpServer)
        .set(updateData)
        .where(eq(workflowMcpServer.id, serverId))
        .returning()

      logger.info(`[${requestId}] Successfully updated workflow MCP server: ${serverId}`)

      return createMcpSuccessResponse({ server: updatedServer })
    } catch (error) {
      logger.error(`[${requestId}] Error updating workflow MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to update workflow MCP server'),
        'Failed to update workflow MCP server',
        500
      )
    }
  }
)

/**
 * DELETE - Delete a workflow MCP server and all its tools
 */
export const DELETE = withMcpAuth<RouteParams>('admin')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params

      logger.info(`[${requestId}] Deleting workflow MCP server: ${serverId}`)

      const [deletedServer] = await db
        .delete(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .returning()

      if (!deletedServer) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      logger.info(`[${requestId}] Successfully deleted workflow MCP server: ${serverId}`)

      return createMcpSuccessResponse({ message: `Server ${serverId} deleted successfully` })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting workflow MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to delete workflow MCP server'),
        'Failed to delete workflow MCP server',
        500
      )
    }
  }
)
