import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import type { McpToolDiscoveryResponse } from '@/lib/mcp/types'
import { categorizeError, createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpToolDiscoveryAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - Discover all tools from user's MCP servers
 */
export const GET = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const { searchParams } = new URL(request.url)
      const serverId = searchParams.get('serverId')
      const forceRefresh = searchParams.get('refresh') === 'true'

      logger.info(`[${requestId}] Discovering MCP tools for user ${userId}`, {
        serverId,
        workspaceId,
        forceRefresh,
      })

      let tools
      if (serverId) {
        tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
      } else {
        tools = await mcpService.discoverTools(userId, workspaceId, forceRefresh)
      }

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
)

/**
 * POST - Refresh tool discovery for specific servers
 */
export const POST = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const body = getParsedBody(request) || (await request.json())
      const { serverIds } = body

      if (!Array.isArray(serverIds)) {
        return createMcpErrorResponse(
          new Error('serverIds must be an array'),
          'Invalid request format',
          400
        )
      }

      logger.info(
        `[${requestId}] Refreshing tool discovery for user ${userId}, servers:`,
        serverIds
      )

      const results = await Promise.allSettled(
        serverIds.map(async (serverId: string) => {
          const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
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
)
