import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpApiResponse } from '@/lib/mcp/types'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpServerRefreshAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Refresh an MCP server connection
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const serverId = params.id

  try {
    logger.info(`[${requestId}] Refreshing MCP server: ${serverId}`)

    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required',
        },
        { status: 401 }
      )
    }

    const userId = session.user.id
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required',
        },
        { status: 401 }
      )
    }

    // Check if server exists and belongs to user
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)))
      .limit(1)

    if (!server) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server not found or access denied',
        },
        { status: 404 }
      )
    }

    // Test actual connection and discover tools
    let connectionStatus: 'connected' | 'disconnected' | 'error' = 'error'
    let toolCount = 0
    let lastError: string | null = null

    try {
      // Use the MCP service to test connection and discover tools
      const tools = await mcpService.discoverServerTools(userId, serverId, true) // Force refresh
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

    // Update server status in database
    const [refreshedServer] = await db
      .update(mcpServers)
      .set({
        lastToolsRefresh: new Date(),
        connectionStatus,
        lastError,
        lastConnected: connectionStatus === 'connected' ? new Date() : server.lastConnected,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, serverId))
      .returning()

    const response: McpApiResponse = {
      success: true,
      data: {
        status: connectionStatus,
        toolCount,
        lastConnected: refreshedServer.lastConnected?.toISOString() || null,
        error: lastError,
      },
    }

    logger.info(`[${requestId}] Successfully refreshed MCP server: ${serverId}`)
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error refreshing MCP server:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh MCP server',
      },
      { status: 500 }
    )
  }
}
