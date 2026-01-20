import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'

const logger = createLogger('WorkflowMcpToolAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
  toolId: string
}

/**
 * GET - Get a specific tool
 */
export const GET = withMcpAuth<RouteParams>('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId, toolId } = await params

      logger.info(`[${requestId}] Getting tool ${toolId} from server ${serverId}`)

      const [server] = await db
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const [tool] = await db
        .select()
        .from(workflowMcpTool)
        .where(and(eq(workflowMcpTool.id, toolId), eq(workflowMcpTool.serverId, serverId)))
        .limit(1)

      if (!tool) {
        return createMcpErrorResponse(new Error('Tool not found'), 'Tool not found', 404)
      }

      return createMcpSuccessResponse({ tool })
    } catch (error) {
      logger.error(`[${requestId}] Error getting tool:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to get tool'),
        'Failed to get tool',
        500
      )
    }
  }
)

/**
 * PATCH - Update a tool's configuration
 */
export const PATCH = withMcpAuth<RouteParams>('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId, toolId } = await params
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Updating tool ${toolId} in server ${serverId}`)

      const [server] = await db
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const [existingTool] = await db
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(and(eq(workflowMcpTool.id, toolId), eq(workflowMcpTool.serverId, serverId)))
        .limit(1)

      if (!existingTool) {
        return createMcpErrorResponse(new Error('Tool not found'), 'Tool not found', 404)
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (body.toolName !== undefined) {
        updateData.toolName = sanitizeToolName(body.toolName)
      }
      if (body.toolDescription !== undefined) {
        updateData.toolDescription = body.toolDescription?.trim() || null
      }
      if (body.parameterSchema !== undefined) {
        updateData.parameterSchema = body.parameterSchema
      }

      const [updatedTool] = await db
        .update(workflowMcpTool)
        .set(updateData)
        .where(eq(workflowMcpTool.id, toolId))
        .returning()

      logger.info(`[${requestId}] Successfully updated tool ${toolId}`)

      return createMcpSuccessResponse({ tool: updatedTool })
    } catch (error) {
      logger.error(`[${requestId}] Error updating tool:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to update tool'),
        'Failed to update tool',
        500
      )
    }
  }
)

/**
 * DELETE - Remove a tool from an MCP server
 */
export const DELETE = withMcpAuth<RouteParams>('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId, toolId } = await params

      logger.info(`[${requestId}] Deleting tool ${toolId} from server ${serverId}`)

      const [server] = await db
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const [deletedTool] = await db
        .delete(workflowMcpTool)
        .where(and(eq(workflowMcpTool.id, toolId), eq(workflowMcpTool.serverId, serverId)))
        .returning()

      if (!deletedTool) {
        return createMcpErrorResponse(new Error('Tool not found'), 'Tool not found', 404)
      }

      logger.info(`[${requestId}] Successfully deleted tool ${toolId}`)

      return createMcpSuccessResponse({ message: `Tool ${toolId} deleted successfully` })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting tool:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to delete tool'),
        'Failed to delete tool',
        500
      )
    }
  }
)
