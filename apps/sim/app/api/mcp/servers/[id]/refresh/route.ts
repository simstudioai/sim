import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpApiResponse } from '@/lib/mcp/types'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpServerRefreshAPI')

export const dynamic = 'force-dynamic'

/**
 * POST - Refresh an MCP server connection (requires any workspace permission)
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = generateRequestId()
  const serverId = params.id

  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        {
          success: false,
          error: auth.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: 'workspaceId parameter is required',
        },
        { status: 400 }
      )
    }

    // Validate user has permission to refresh MCP servers in this workspace (any permission level)
    const hasWorkspaceAccess = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!hasWorkspaceAccess) {
      return NextResponse.json(
        {
          success: false,
          error: 'Access denied to workspace',
        },
        { status: 403 }
      )
    }

    logger.info(`[${requestId}] Refreshing MCP server: ${serverId} in workspace: ${workspaceId}`, {
      userId: auth.userId,
    })

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
      return NextResponse.json(
        {
          success: false,
          error: 'Server not found or access denied',
        },
        { status: 404 }
      )
    }

    let connectionStatus: 'connected' | 'disconnected' | 'error' = 'error'
    let toolCount = 0
    let lastError: string | null = null

    try {
      const tools = await mcpService.discoverServerTools(auth.userId, serverId, workspaceId, true) // Force refresh
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

    const response: McpApiResponse = {
      success: true,
      data: {
        status: connectionStatus,
        toolCount,
        lastConnected: refreshedServer?.lastConnected?.toISOString() || null,
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
