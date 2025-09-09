import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpApiResponse } from '@/lib/mcp/types'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server in the workspace (requires write or admin permission)
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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

    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: 'workspaceId is required',
        },
        { status: 400 }
      )
    }

    // Validate user has write or admin permission to update MCP servers in this workspace
    const userPermissions = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!userPermissions || (userPermissions !== 'write' && userPermissions !== 'admin')) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Insufficient permissions - write or admin permission required to update MCP servers',
        },
        { status: 403 }
      )
    }

    logger.info(`[${requestId}] Updating MCP server: ${serverId} in workspace: ${workspaceId}`, {
      userId: auth.userId,
      updates: Object.keys(body).filter((k) => k !== 'workspaceId'),
    })

    // Validate URL if being updated
    if (
      body.url &&
      (body.transport === 'http' ||
        body.transport === 'sse' ||
        body.transport === 'streamable-http')
    ) {
      const urlValidation = validateMcpServerUrl(body.url)
      if (!urlValidation.isValid) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid MCP server URL: ${urlValidation.error}`,
          },
          { status: 400 }
        )
      }
      body.url = urlValidation.normalizedUrl
    }

    // Remove workspaceId from body to prevent it from being updated
    const { workspaceId: _, ...updateData } = body

    const [updatedServer] = await db
      .update(mcpServers)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.workspaceId, workspaceId),
          isNull(mcpServers.deletedAt)
        )
      )
      .returning()

    if (!updatedServer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server not found or access denied',
        },
        { status: 404 }
      )
    }

    // Clear MCP service cache after update
    mcpService.clearCache(workspaceId)

    const response: McpApiResponse = {
      success: true,
      data: { server: updatedServer },
    }

    logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error updating MCP server:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MCP server',
      },
      { status: 500 }
    )
  }
}
