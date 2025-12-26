import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server in the workspace (requires write or admin permission)
 */
export const PATCH = withMcpAuth<{ id: string }>('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    const { id: serverId } = await params

    try {
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Updating MCP server: ${serverId} in workspace: ${workspaceId}`, {
        userId,
        updates: Object.keys(body).filter((k) => k !== 'workspaceId'),
      })

      // Remove workspaceId from body to prevent it from being updated
      const { workspaceId: _, ...updateData } = body

      // Get the current server to check if URL is changing
      const [currentServer] = await db
        .select({ url: mcpServers.url })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

      const [updatedServer] = await db
        .update(mcpServers)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .returning()

      if (!updatedServer) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      // Only clear cache if URL changed (requires re-discovery)
      const urlChanged = body.url && currentServer?.url !== body.url
      if (urlChanged) {
        await mcpService.clearCache(workspaceId)
        logger.info(`[${requestId}] Cleared cache due to URL change`)
      }

      logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)
      return createMcpSuccessResponse({ server: updatedServer })
    } catch (error) {
      logger.error(`[${requestId}] Error updating MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to update MCP server'),
        'Failed to update MCP server',
        500
      )
    }
  }
)
