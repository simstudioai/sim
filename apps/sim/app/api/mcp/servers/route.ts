import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { mcpService } from '@/lib/mcp/service'
import type { McpApiResponse } from '@/lib/mcp/types'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all registered MCP servers for the current user
 */
export async function GET() {
  const requestId = generateRequestId()

  try {
    logger.info(`[${requestId}] Listing MCP servers`)

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

    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.userId, userId), isNull(mcpServers.deletedAt)))

    const response: McpApiResponse = {
      success: true,
      data: {
        servers,
      },
    }

    logger.info(`[${requestId}] Listed ${servers.length} MCP servers for user ${userId}`)
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
 * POST - Register a new MCP server for the current user
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    logger.info(`[${requestId}] Registering new MCP server:`, {
      name: body.name,
      transport: body.transport,
    })

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
        userId,
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

    mcpService.clearCache(session.user.id)

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
 * DELETE - Delete an MCP server for the current user (hard delete)
 */
export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const serverId = searchParams.get('serverId')

    if (!serverId) {
      return NextResponse.json(
        {
          success: false,
          error: 'serverId parameter is required',
        },
        { status: 400 }
      )
    }

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

    logger.info(`[${requestId}] Deleting MCP server: ${serverId}`)

    const [deletedServer] = await db
      .delete(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)))
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

    mcpService.clearCache(session.user.id)

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
