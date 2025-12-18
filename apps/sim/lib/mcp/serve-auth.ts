import { db } from '@sim/db'
import { workflowMcpServer } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('McpServeAuth')

export interface McpServeAuthResult {
  success: boolean
  userId?: string
  workspaceId?: string
  error?: string
}

/**
 * Validates authentication for accessing a workflow MCP server.
 *
 * Authentication can be done via:
 * 1. API Key (X-API-Key header) - for programmatic access
 * 2. Session cookie - for logged-in users
 *
 * The user must have at least read access to the workspace that owns the server.
 */
export async function validateMcpServeAuth(
  request: NextRequest,
  serverId: string
): Promise<McpServeAuthResult> {
  try {
    // First, get the server to find its workspace
    const [server] = await db
      .select({
        id: workflowMcpServer.id,
        workspaceId: workflowMcpServer.workspaceId,
        isPublished: workflowMcpServer.isPublished,
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.id, serverId))
      .limit(1)

    if (!server) {
      return { success: false, error: 'Server not found' }
    }

    if (!server.isPublished) {
      return { success: false, error: 'Server is not published' }
    }

    // Check authentication using hybrid auth (supports both session and API key)
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!auth.success || !auth.userId) {
      return { success: false, error: auth.error || 'Authentication required' }
    }

    return {
      success: true,
      userId: auth.userId,
      workspaceId: server.workspaceId,
    }
  } catch (error) {
    logger.error('Error validating MCP serve auth:', error)
    return {
      success: false,
      error: 'Authentication validation failed',
    }
  }
}

/**
 * Get connection instructions for an MCP server.
 * This provides the information users need to connect their MCP clients.
 */
export function getMcpServerConnectionInfo(
  serverId: string,
  serverName: string,
  baseUrl: string
): {
  sseUrl: string
  httpUrl: string
  authHeader: string
  instructions: string
} {
  const sseUrl = `${baseUrl}/api/mcp/serve/${serverId}/sse`
  const httpUrl = `${baseUrl}/api/mcp/serve/${serverId}`

  return {
    sseUrl,
    httpUrl,
    authHeader: 'X-API-Key: YOUR_SIM_API_KEY',
    instructions: `
To connect to this MCP server from Cursor or Claude Desktop:

1. Get your Sim API key from Settings -> API Keys
2. Configure your MCP client with:
   - Server URL: ${sseUrl}
   - Authentication: Add header "X-API-Key" with your API key

For Cursor, add to your MCP configuration:
{
  "mcpServers": {
    "${serverName.toLowerCase().replace(/\s+/g, '-')}": {
      "url": "${sseUrl}",
      "headers": {
        "X-API-Key": "YOUR_SIM_API_KEY"
      }
    }
  }
}

For Claude Desktop, configure similarly in your settings.
    `.trim(),
  }
}
