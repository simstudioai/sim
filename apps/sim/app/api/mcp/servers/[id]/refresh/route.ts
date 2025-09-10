import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpServerRefreshAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Refresh an MCP server connection (requires any workspace permission)
 */
export const POST = withMcpAuth('read')(
  async (
    request: NextRequest,
    { userId, workspaceId, requestId },
    { params }: { params: { id: string } }
  ) => {
    const serverId = params.id

    try {
      logger.info(
        `[${requestId}] Refreshing MCP server: ${serverId} in workspace: ${workspaceId}`,
        {
          userId,
        }
      )

      const [server] = await db
        .select()
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      let connectionStatus: 'connected' | 'disconnected' | 'error' = 'error'
      let toolCount = 0
      let lastError: string | null = null

      try {
        const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
        connectionStatus = 'connected'
        toolCount = tools.length
        logger.info(
          `[${requestId}] Successfully connected to server ${serverId}, discovered ${toolCount} tools`
        )
      } catch (error) {
        connectionStatus = 'error'
        lastError = error instanceof Error ? error.message : 'Connection test failed'
        logger.warn(`[${requestId}] Failed to connect to server ${serverId}:`, error)
      }

      const [refreshedServer] = await db
        .update(mcpServers)
        .set({
          lastToolsRefresh: new Date(),
          connectionStatus,
          lastError,
          lastConnected: connectionStatus === 'connected' ? new Date() : server.lastConnected,
          toolCount,
          updatedAt: new Date(),
        })
        .where(eq(mcpServers.id, serverId))
        .returning()

      logger.info(`[${requestId}] Successfully refreshed MCP server: ${serverId}`)
      return createMcpSuccessResponse({
        status: connectionStatus,
        toolCount,
        lastConnected: refreshedServer?.lastConnected?.toISOString() || null,
        error: lastError,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to refresh MCP server'),
        'Failed to refresh MCP server',
        500
      )
    }
  }
)
