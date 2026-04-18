import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import {
  McpDnsResolutionError,
  McpDomainNotAllowedError,
  McpSsrfError,
  validateMcpDomain,
  validateMcpServerSsrf,
} from '@/lib/mcp/domain-check'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpServerAPI')

export const dynamic = 'force-dynamic'

/**
 * PATCH - Update an MCP server in the workspace (requires write or admin permission)
 */
export const PATCH = withMcpAuth<{ id: string }>('write')(
  async (
    request: NextRequest,
    { userId, userName, userEmail, workspaceId, requestId },
    { params }
  ) => {
    const { id: serverId } = await params

    try {
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Updating MCP server: ${serverId} in workspace: ${workspaceId}`, {
        userId,
        updates: Object.keys(body).filter((k) => k !== 'workspaceId'),
      })

      // Remove workspaceId from body to prevent it from being updated
      const { workspaceId: _, ...updateData } = body

      if (updateData.url) {
        try {
          validateMcpDomain(updateData.url)
        } catch (e) {
          if (e instanceof McpDomainNotAllowedError) {
            return createMcpErrorResponse(e, e.message, 403)
          }
          throw e
        }

        try {
          await validateMcpServerSsrf(updateData.url)
        } catch (e) {
          if (e instanceof McpDnsResolutionError) {
            return createMcpErrorResponse(e, e.message, 502)
          }
          if (e instanceof McpSsrfError) {
            return createMcpErrorResponse(e, e.message, 403)
          }
          throw e
        }
      }

      // Get the current server to check if URL is changing
      const [currentServer] = await db
        .select({ url: mcpServers.url })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

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
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      const shouldClearCache =
        (body.url !== undefined && currentServer?.url !== body.url) ||
        body.enabled !== undefined ||
        body.headers !== undefined ||
        body.timeout !== undefined ||
        body.retries !== undefined

      if (shouldClearCache) {
        await mcpService.clearCache(workspaceId)
        logger.info(`[${requestId}] Cleared MCP cache after server lifecycle update`)
      }

      logger.info(`[${requestId}] Successfully updated MCP server: ${serverId}`)

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: userName,
        actorEmail: userEmail,
        action: AuditAction.MCP_SERVER_UPDATED,
        resourceType: AuditResourceType.MCP_SERVER,
        resourceId: serverId,
        resourceName: updatedServer.name || serverId,
        description: `Updated MCP server "${updatedServer.name || serverId}"`,
        metadata: {
          serverName: updatedServer.name,
          transport: updatedServer.transport,
          url: updatedServer.url,
          updatedFields: Object.keys(updateData).filter(
            (k) => k !== 'workspaceId' && k !== 'updatedAt'
          ),
        },
        request,
      })

      return createMcpSuccessResponse({ server: updatedServer })
    } catch (error) {
      logger.error(`[${requestId}] Error updating MCP server:`, error)
      return createMcpErrorResponse(toError(error), 'Failed to update MCP server', 500)
    }
  }
)
