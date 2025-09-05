import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpApiResponse } from '@/lib/mcp/types'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { mcpServers } from '@/db/schema'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server for the current user
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = generateRequestId()
  const serverId = params.id

  try {
    const body = await request.json()
    logger.info(`[${requestId}] Updating MCP server: ${serverId}`)

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

    if (body.url && (body.transport === 'http' || body.transport === 'sse')) {
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

    const [updatedServer] = await db
      .update(mcpServers)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.userId, userId)))
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
