import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import type { McpServerStatusConfig } from '@/lib/mcp/types'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpServerRefreshAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Refresh an MCP server connection (requires any workspace permission)
 */
export const POST = withMcpAuth<{ id: string }>('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    const { id: serverId } = await params

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

      const currentStatusConfig: McpServerStatusConfig =
        (server.statusConfig as McpServerStatusConfig | null) ?? {
          consecutiveFailures: 0,
          lastSuccessfulDiscovery: null,
        }

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

      const now = new Date()
      const newStatusConfig =
        connectionStatus === 'connected'
          ? { consecutiveFailures: 0, lastSuccessfulDiscovery: now.toISOString() }
          : {
              consecutiveFailures: currentStatusConfig.consecutiveFailures + 1,
              lastSuccessfulDiscovery: currentStatusConfig.lastSuccessfulDiscovery,
            }

      const [refreshedServer] = await db
        .update(mcpServers)
        .set({
          lastToolsRefresh: now,
          connectionStatus,
          lastError,
          lastConnected: connectionStatus === 'connected' ? now : server.lastConnected,
          toolCount,
          statusConfig: newStatusConfig,
          updatedAt: now,
        })
        .where(eq(mcpServers.id, serverId))
        .returning()

      if (connectionStatus === 'connected') {
        logger.info(
          `[${requestId}] Successfully refreshed MCP server: ${serverId} (${toolCount} tools)`
        )
        await mcpService.clearCache(workspaceId)
      } else {
        logger.warn(
          `[${requestId}] Refresh completed for MCP server ${serverId} but connection failed: ${lastError}`
        )
      }

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
