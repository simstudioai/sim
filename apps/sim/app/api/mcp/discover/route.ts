import { db } from '@sim/db'
import { permissions, workflowMcpServer, workspace } from '@sim/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('McpDiscoverAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - Discover all published MCP servers available to the authenticated user
 * 
 * This endpoint allows external MCP clients to discover available servers
 * using just their API key, without needing to know workspace IDs.
 * 
 * Authentication: API Key (X-API-Key header) or Session
 * 
 * Returns all published MCP servers from workspaces the user has access to.
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate the request
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Authentication required. Provide X-API-Key header with your Sim API key.' 
        },
        { status: 401 }
      )
    }

    const userId = auth.userId

    // Get all workspaces the user has access to via permissions table
    const userWorkspacePermissions = await db
      .select({ entityId: permissions.entityId })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace')
        )
      )

    const workspaceIds = userWorkspacePermissions.map(w => w.entityId)

    if (workspaceIds.length === 0) {
      return NextResponse.json({
        success: true,
        servers: [],
        message: 'No workspaces found for this user',
      })
    }

    // Get all published MCP servers from user's workspaces with tool count
    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
        workspaceId: workflowMcpServer.workspaceId,
        workspaceName: workspace.name,
        isPublished: workflowMcpServer.isPublished,
        publishedAt: workflowMcpServer.publishedAt,
        toolCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM "workflow_mcp_tool" 
          WHERE "workflow_mcp_tool"."server_id" = "workflow_mcp_server"."id"
        )`.as('tool_count'),
      })
      .from(workflowMcpServer)
      .leftJoin(workspace, eq(workflowMcpServer.workspaceId, workspace.id))
      .where(
        and(
          eq(workflowMcpServer.isPublished, true),
          sql`${workflowMcpServer.workspaceId} IN ${workspaceIds}`
        )
      )
      .orderBy(workflowMcpServer.name)

    const baseUrl = getBaseUrl()

    // Format response with connection URLs
    const formattedServers = servers.map(server => ({
      id: server.id,
      name: server.name,
      description: server.description,
      workspace: {
        id: server.workspaceId,
        name: server.workspaceName,
      },
      toolCount: server.toolCount || 0,
      publishedAt: server.publishedAt,
      urls: {
        http: `${baseUrl}/api/mcp/serve/${server.id}`,
        sse: `${baseUrl}/api/mcp/serve/${server.id}/sse`,
      },
    }))

    logger.info(`User ${userId} discovered ${formattedServers.length} MCP servers`)

    return NextResponse.json({
      success: true,
      servers: formattedServers,
      authentication: {
        method: 'API Key',
        header: 'X-API-Key',
        description: 'Include your Sim API key in the X-API-Key header for all MCP requests',
      },
      usage: {
        listTools: {
          method: 'POST',
          body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        },
        callTool: {
          method: 'POST', 
          body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"TOOL_NAME","arguments":{}}}',
        },
      },
    })
  } catch (error) {
    logger.error('Error discovering MCP servers:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to discover MCP servers' },
      { status: 500 }
    )
  }
}
