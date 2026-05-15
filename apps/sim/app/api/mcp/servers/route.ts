import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createMcpServerBodySchema, deleteMcpServerByQuerySchema } from '@/lib/api/contracts/mcp'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { performCreateMcpServer, performDeleteMcpServer } from '@/lib/mcp/orchestration'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  mcpOrchestrationStatus,
} from '@/lib/mcp/utils'

const logger = createLogger('McpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all registered MCP servers for the workspace
 */
export const GET = withRouteHandler(
  withMcpAuth('read')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
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
      return createMcpErrorResponse(toError(error), 'Failed to list MCP servers', 500)
    }
  })
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
export const POST = withRouteHandler(
  withMcpAuth('write')(
    async (request: NextRequest, { userId, userName, userEmail, workspaceId, requestId }) => {
      try {
        const rawBody = getParsedBody(request) ?? (await request.json())
        const parsedBody = createMcpServerBodySchema.safeParse(rawBody)

        if (!parsedBody.success) {
          return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
        }

        const body = parsedBody.data

        logger.info(`[${requestId}] Registering MCP server:`, {
          name: body.name,
          transport: body.transport,
          workspaceId,
        })

        const sourceParam = body.source as string | undefined
        const source =
          sourceParam === 'settings' || sourceParam === 'tool_input' ? sourceParam : undefined
        if (!body.url) {
          return createMcpErrorResponse(
            new Error('url is required'),
            'Missing required parameter',
            400
          )
        }
        const result = await performCreateMcpServer({
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          name: body.name,
          description: body.description,
          transport: body.transport,
          url: body.url,
          headers: body.headers,
          timeout: body.timeout,
          retries: body.retries,
          enabled: body.enabled,
          source,
          request,
        })
        if (!result.success || !result.serverId) {
          return createMcpErrorResponse(
            new Error(result.error || 'Failed to register MCP server'),
            result.error || 'Failed to register MCP server',
            mcpOrchestrationStatus(result.errorCode)
          )
        }

        logger.info(
          `[${requestId}] Successfully registered MCP server: ${body.name} (ID: ${result.serverId})`
        )

        return createMcpSuccessResponse(
          result.updated
            ? { serverId: result.serverId, updated: true }
            : { serverId: result.serverId },
          result.updated ? 200 : 201
        )
      } catch (error) {
        logger.error(`[${requestId}] Error registering MCP server:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to register MCP server', 500)
      }
    }
  )
)

/**
 * DELETE - Delete an MCP server from the workspace (requires admin permission)
 */
export const DELETE = withRouteHandler(
  withMcpAuth('admin')(
    async (request: NextRequest, { userId, userName, userEmail, workspaceId, requestId }) => {
      try {
        const { searchParams } = new URL(request.url)
        const queryValidation = deleteMcpServerByQuerySchema.safeParse(
          Object.fromEntries(searchParams)
        )
        if (!queryValidation.success) return validationErrorResponse(queryValidation.error)
        const query = queryValidation.data
        const serverId = query.serverId
        const sourceParam = query.source
        const source =
          sourceParam === 'settings' || sourceParam === 'tool_input' ? sourceParam : undefined

        if (!serverId) {
          return createMcpErrorResponse(
            new Error('serverId parameter is required'),
            'Missing required parameter',
            400
          )
        }

        logger.info(
          `[${requestId}] Deleting MCP server: ${serverId} from workspace: ${workspaceId}`
        )

        const result = await performDeleteMcpServer({
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          serverId,
          source,
          request,
        })
        if (!result.success || !result.server) {
          return createMcpErrorResponse(
            new Error(result.error || 'Failed to delete MCP server'),
            result.error || 'Failed to delete MCP server',
            mcpOrchestrationStatus(result.errorCode)
          )
        }

        logger.info(`[${requestId}] Successfully deleted MCP server: ${serverId}`)

        return createMcpSuccessResponse({ message: `Server ${serverId} deleted successfully` })
      } catch (error) {
        logger.error(`[${requestId}] Error deleting MCP server:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to delete MCP server', 500)
      }
    }
  )
)
