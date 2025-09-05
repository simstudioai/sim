import type { NextRequest } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpToolDiscoveryResponse } from '@/lib/mcp/types'
import { categorizeError, createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('McpToolDiscoveryAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - Discover all tools from user's MCP servers
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get authenticated user using hybrid auth
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createMcpErrorResponse(
        new Error(auth.error || 'Authentication required'),
        'Authentication failed',
        401
      )
    }

    const userId = auth.userId

    const { searchParams } = new URL(request.url)
    const serverId = searchParams.get('serverId')
    const workspaceId = searchParams.get('workspaceId') || undefined
    const forceRefresh = searchParams.get('refresh') === 'true'

    logger.info(`[${requestId}] Discovering MCP tools for user ${userId}`, {
      serverId,
      workspaceId,
      forceRefresh,
    })

    let tools
    if (serverId) {
      // Discover tools from specific server
      tools = await mcpService.discoverServerTools(userId, serverId, forceRefresh)
    } else {
      // Discover tools from all user servers
      tools = await mcpService.discoverTools(userId, workspaceId, forceRefresh)
    }

    // Group tools by server for statistics
    const byServer: Record<string, number> = {}
    for (const tool of tools) {
      byServer[tool.serverId] = (byServer[tool.serverId] || 0) + 1
    }

    const responseData: McpToolDiscoveryResponse = {
      tools,
      totalCount: tools.length,
      byServer,
    }

    logger.info(
      `[${requestId}] Discovered ${tools.length} tools from ${Object.keys(byServer).length} servers`
    )
    return createMcpSuccessResponse(responseData)
  } catch (error) {
    logger.error(`[${requestId}] Error discovering MCP tools:`, error)
    const { message, status } = categorizeError(error)
    return createMcpErrorResponse(new Error(message), 'Failed to discover MCP tools', status)
  }
}

/**
 * POST - Refresh tool discovery for specific servers
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get authenticated user using hybrid auth
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createMcpErrorResponse(
        new Error(auth.error || 'Authentication required'),
        'Authentication failed',
        401
      )
    }

    const body = await request.json()
    const { serverIds } = body

    if (!Array.isArray(serverIds)) {
      return createMcpErrorResponse(
        new Error('serverIds must be an array'),
        'Invalid request format',
        400
      )
    }

    logger.info(
      `[${requestId}] Refreshing tool discovery for user ${auth.userId}, servers:`,
      serverIds
    )

    const results = await Promise.allSettled(
      serverIds.map(async (serverId: string) => {
        const tools = await mcpService.discoverServerTools(auth.userId!, serverId, true)
        return { serverId, toolCount: tools.length }
      })
    )

    const successes: Array<{ serverId: string; toolCount: number }> = []
    const failures: Array<{ serverId: string; error: string }> = []

    results.forEach((result, index) => {
      const serverId = serverIds[index]
      if (result.status === 'fulfilled') {
        successes.push(result.value)
      } else {
        failures.push({
          serverId,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        })
      }
    })

    const responseData = {
      refreshed: successes,
      failed: failures,
      summary: {
        total: serverIds.length,
        successful: successes.length,
        failed: failures.length,
      },
    }

    logger.info(
      `[${requestId}] Tool discovery refresh completed: ${successes.length}/${serverIds.length} successful`
    )
    return createMcpSuccessResponse(responseData)
  } catch (error) {
    logger.error(`[${requestId}] Error refreshing tool discovery:`, error)
    const { message, status } = categorizeError(error)
    return createMcpErrorResponse(new Error(message), 'Failed to refresh tool discovery', status)
  }
}
