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

const logger = createLogger('McpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all registered MCP servers for the workspace
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

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
          error: 'workspaceId is required',
        },
        { status: 400 }
      )
    }

    // Validate user has permission to access MCP servers in this workspace (any permission level)
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

    logger.info(`[${requestId}] Listing MCP servers for workspace ${workspaceId}`)

    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))

    const response: McpApiResponse = {
      success: true,
      data: {
        servers,
      },
    }

    logger.info(`[${requestId}] Listed ${servers.length} MCP servers for workspace ${workspaceId}`)
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error listing MCP servers:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list MCP servers',
      },
      { status: 500 }
    )
  }
}

/**
 * POST - Register a new MCP server for the workspace (requires write permission)
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

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

    // Validate user has write permission to add MCP servers to this workspace
    const userPermissions = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!userPermissions || (userPermissions !== 'write' && userPermissions !== 'admin')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient permissions - write or admin permission required to add MCP servers',
        },
        { status: 403 }
      )
    }

    logger.info(`[${requestId}] Registering new MCP server:`, {
      name: body.name,
      transport: body.transport,
      workspaceId,
    })

    if (!body.name || !body.transport) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: name or transport',
        },
        { status: 400 }
      )
    }

    if (
      (body.transport === 'http' ||
        body.transport === 'sse' ||
        body.transport === 'streamable-http') &&
      body.url
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

    const serverId = body.id || crypto.randomUUID()

    await db
      .insert(mcpServers)
      .values({
        id: serverId,
        workspaceId,
        createdBy: auth.userId,
        name: body.name,
        description: body.description,
        transport: body.transport,
        url: body.url,
        headers: body.headers || {},
        timeout: body.timeout || 30000,
        retries: body.retries || 3,
        enabled: body.enabled !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    mcpService.clearCache(workspaceId)

    const response: McpApiResponse = {
      success: true,
      data: { serverId: serverId },
    }

    logger.info(`[${requestId}] Successfully registered MCP server: ${body.name}`)
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    logger.error(`[${requestId}] Error registering MCP server:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to register MCP server',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE - Delete an MCP server from the workspace (requires admin permission)
 */
export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()

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
    const serverId = searchParams.get('serverId')
    const workspaceId = searchParams.get('workspaceId')

    if (!serverId) {
      return NextResponse.json(
        {
          success: false,
          error: 'serverId parameter is required',
        },
        { status: 400 }
      )
    }

    if (!workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: 'workspaceId parameter is required',
        },
        { status: 400 }
      )
    }

    // Validate user has admin permission to delete MCP servers from this workspace
    const userPermissions = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!userPermissions || userPermissions !== 'admin') {
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient permissions - admin permission required to delete MCP servers',
        },
        { status: 403 }
      )
    }

    logger.info(`[${requestId}] Deleting MCP server: ${serverId} from workspace: ${workspaceId}`)

    const [deletedServer] = await db
      .delete(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .returning()

    if (!deletedServer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server not found or access denied',
        },
        { status: 404 }
      )
    }

    mcpService.clearCache(workspaceId)

    const response: McpApiResponse = {
      success: true,
      data: { message: `Server ${serverId} deleted successfully` },
    }

    logger.info(`[${requestId}] Successfully deleted MCP server: ${serverId}`)
    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error deleting MCP server:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server',
      },
      { status: 500 }
    )
  }
}
