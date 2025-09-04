import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpApiResponse, McpToolDiscoveryResponse } from '@/lib/mcp/types'

const logger = createLogger('McpToolDiscoveryAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - Discover all tools from user's MCP servers
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get authenticated user - support both session and internal token auth
    let userId: string | undefined

    // First try session authentication
    const session = await getSession()
    if (session?.user?.id) {
      userId = session.user.id
    } else {
      // If no session, check for internal token authentication
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7)
        const isValidToken = await verifyInternalToken(token)
        if (isValidToken) {
          // For internal tokens, get the user ID from workflow context (like execute route)
          const { searchParams } = new URL(request.url)
          const workflowId = searchParams.get('workflowId')
          if (!workflowId) {
            return NextResponse.json(
              { success: false, error: 'workflowId required for internal token authentication' },
              { status: 400 }
            )
          }

          // Get workflow owner as user context (same pattern as execute route)
          const { eq } = await import('drizzle-orm')
          const { db } = await import('@/db')
          const { workflow } = await import('@/db/schema')

          const [workflowData] = await db
            .select({ userId: workflow.userId })
            .from(workflow)
            .where(eq(workflow.id, workflowId))
            .limit(1)

          if (!workflowData) {
            return NextResponse.json(
              { success: false, error: 'Workflow not found' },
              { status: 404 }
            )
          }

          userId = workflowData.userId
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

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

    const response: McpApiResponse<McpToolDiscoveryResponse> = {
      success: true,
      data: {
        tools,
        totalCount: tools.length,
        byServer,
      },
    }

    logger.info(
      `[${requestId}] Discovered ${tools.length} tools from ${Object.keys(byServer).length} servers`
    )
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error discovering MCP tools:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to discover MCP tools',
      },
      { status: 500 }
    )
  }
}

/**
 * POST - Refresh tool discovery for specific servers
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get authenticated user
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { serverIds } = body

    if (!Array.isArray(serverIds)) {
      return NextResponse.json(
        {
          success: false,
          error: 'serverIds must be an array',
        },
        { status: 400 }
      )
    }

    logger.info(
      `[${requestId}] Refreshing tool discovery for user ${session.user.id}, servers:`,
      serverIds
    )

    const results = await Promise.allSettled(
      serverIds.map(async (serverId: string) => {
        const tools = await mcpService.discoverServerTools(session.user.id, serverId, true)
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

    const response: McpApiResponse = {
      success: true,
      data: {
        refreshed: successes,
        failed: failures,
        summary: {
          total: serverIds.length,
          successful: successes.length,
          failed: failures.length,
        },
      },
    }

    logger.info(
      `[${requestId}] Tool discovery refresh completed: ${successes.length}/${serverIds.length} successful`
    )
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error refreshing tool discovery:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh tool discovery',
      },
      { status: 500 }
    )
  }
}
