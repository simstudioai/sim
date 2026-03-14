import { db } from '@sim/db'
import { permissions, workflowMcpServer, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('McpDiscoverAPI')

export const dynamic = 'force-dynamic'

/**
 * Discover all MCP servers available to the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Provide X-API-Key header.' },
        { status: 401 }
      )
    }

    const userId = auth.userId

    if (auth.apiKeyType === 'workspace' && !auth.workspaceId) {
      return NextResponse.json(
        { success: false, error: 'Workspace API key missing workspace scope' },
        { status: 403 }
      )
    }

    const userWorkspacePermissions = await db
      .select({ entityId: permissions.entityId })
      .from(permissions)
      .innerJoin(workspace, eq(permissions.entityId, workspace.id))
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          isNull(workspace.archivedAt)
        )
      )

    const workspaceIds =
      auth.apiKeyType === 'workspace' && auth.workspaceId
        ? userWorkspacePermissions
            .map((w) => w.entityId)
            .filter((workspaceId) => workspaceId === auth.workspaceId)
        : userWorkspacePermissions.map((w) => w.entityId)

    if (workspaceIds.length === 0) {
      return NextResponse.json({ success: true, servers: [] })
    }

    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
        workspaceId: workflowMcpServer.workspaceId,
        workspaceName: workspace.name,
        createdAt: workflowMcpServer.createdAt,
        toolCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM "workflow_mcp_tool" 
          WHERE "workflow_mcp_tool"."server_id" = "workflow_mcp_server"."id"
            AND "workflow_mcp_tool"."archived_at" IS NULL
        )`.as('tool_count'),
      })
      .from(workflowMcpServer)
      .leftJoin(workspace, eq(workflowMcpServer.workspaceId, workspace.id))
      .where(
        and(
          sql`${workflowMcpServer.workspaceId} IN ${workspaceIds}`,
          isNull(workflowMcpServer.deletedAt),
          isNull(workspace.archivedAt)
        )
      )
      .orderBy(workflowMcpServer.name)

    const baseUrl = getBaseUrl()

    const formattedServers = servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      workspace: { id: server.workspaceId, name: server.workspaceName },
      toolCount: server.toolCount || 0,
      createdAt: server.createdAt,
      url: `${baseUrl}/api/mcp/serve/${server.id}`,
    }))

    logger.info(`User ${userId} discovered ${formattedServers.length} MCP servers`)

    return NextResponse.json({
      success: true,
      servers: formattedServers,
      authentication: {
        method: 'API Key',
        header: 'X-API-Key',
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
