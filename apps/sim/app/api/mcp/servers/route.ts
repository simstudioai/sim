import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  generateMcpServerId,
} from '@/lib/mcp/utils'

const logger = createLogger('McpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all registered MCP servers for the workspace
 */
export const GET = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      logger.info(`[${requestId}] Listing MCP servers for workspace ${workspaceId}`)

      const servers = await db
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))

      logger.info(
        `[${requestId}] Listed ${servers.length} MCP servers for workspace ${workspaceId}`
      )
      return createMcpSuccessResponse({ servers })
    } catch (error) {
      logger.error(`[${requestId}] Error listing MCP servers:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to list MCP servers'),
        'Failed to list MCP servers',
        500
      )
    }
  }
)

/**
 * POST - Register a new MCP server for the workspace (requires write permission)
 *
 * Uses deterministic server IDs based on URL hash to ensure that re-adding
 * the same server produces the same ID. This prevents "server not found" errors
 * when workflows reference the old server ID after delete/re-add cycles.
 *
 * If a server with the same ID already exists (same URL in same workspace),
 * it will be updated instead of creating a duplicate.
 */
export const POST = withMcpAuth('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Registering MCP server:`, {
        name: body.name,
        transport: body.transport,
        workspaceId,
      })

      if (!body.name || !body.transport) {
        return createMcpErrorResponse(
          new Error('Missing required fields: name or transport'),
          'Missing required fields',
          400
        )
      }

      const serverId = body.url ? generateMcpServerId(workspaceId, body.url) : crypto.randomUUID()

      const [existingServer] = await db
        .select({ id: mcpServers.id, deletedAt: mcpServers.deletedAt })
        .from(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
        .limit(1)

      if (existingServer) {
        logger.info(
          `[${requestId}] Server with ID ${serverId} already exists, updating instead of creating`
        )

        await db
          .update(mcpServers)
          .set({
            name: body.name,
            description: body.description,
            transport: body.transport,
            url: body.url,
            headers: body.headers || {},
            timeout: body.timeout || 30000,
            retries: body.retries || 3,
            enabled: body.enabled !== false,
            connectionStatus: 'connected',
            lastConnected: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          })
          .where(eq(mcpServers.id, serverId))

        await mcpService.clearCache(workspaceId)

        logger.info(
          `[${requestId}] Successfully updated MCP server: ${body.name} (ID: ${serverId})`
        )

        return createMcpSuccessResponse({ serverId, updated: true }, 200)
      }

      await db
        .insert(mcpServers)
        .values({
          id: serverId,
          workspaceId,
          createdBy: userId,
          name: body.name,
          description: body.description,
          transport: body.transport,
          url: body.url,
          headers: body.headers || {},
          timeout: body.timeout || 30000,
          retries: body.retries || 3,
          enabled: body.enabled !== false,
          connectionStatus: 'connected',
          lastConnected: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      await mcpService.clearCache(workspaceId)

      logger.info(
        `[${requestId}] Successfully registered MCP server: ${body.name} (ID: ${serverId})`
      )

      try {
        const { PlatformEvents } = await import('@/lib/core/telemetry')
        PlatformEvents.mcpServerAdded({
          serverId,
          serverName: body.name,
          transport: body.transport,
          workspaceId,
        })
      } catch (_e) {
        // Silently fail
      }

      return createMcpSuccessResponse({ serverId }, 201)
    } catch (error) {
      logger.error(`[${requestId}] Error registering MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to register MCP server'),
        'Failed to register MCP server',
        500
      )
    }
  }
)

/**
 * DELETE - Delete an MCP server from the workspace (requires admin permission)
 */
export const DELETE = withMcpAuth('admin')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const { searchParams } = new URL(request.url)
      const serverId = searchParams.get('serverId')

      if (!serverId) {
        return createMcpErrorResponse(
          new Error('serverId parameter is required'),
          'Missing required parameter',
          400
        )
      }

      logger.info(`[${requestId}] Deleting MCP server: ${serverId} from workspace: ${workspaceId}`)

      const [deletedServer] = await db
        .delete(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
        .returning()

      if (!deletedServer) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      await mcpService.clearCache(workspaceId)

      logger.info(`[${requestId}] Successfully deleted MCP server: ${serverId}`)
      return createMcpSuccessResponse({ message: `Server ${serverId} deleted successfully` })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to delete MCP server'),
        'Failed to delete MCP server',
        500
      )
    }
  }
)
