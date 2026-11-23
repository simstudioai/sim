import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  updateWorkflowMcpServerBodySchema,
  workflowMcpServerParamsSchema,
} from '@/lib/api/contracts/workflow-mcp-servers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  mcpBodyReadErrorResponse,
  readMcpJsonBodyWithLimit,
  withMcpAuth,
} from '@/lib/mcp/middleware'
import {
  performDeleteWorkflowMcpServer,
  performUpdateWorkflowMcpServer,
} from '@/lib/mcp/orchestration'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  mcpOrchestrationStatus,
} from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpServerAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
}

/**
 * GET - Get a specific workflow MCP server with its tools
 */
export const GET = withRouteHandler(
  withMcpAuth<RouteParams>(
    'read',
    'deploy.mcp'
  )(async (_request: NextRequest, { workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = workflowMcpServerParamsSchema.parse(await params)

      logger.info(`Getting workflow MCP server: ${serverId}`, { requestId })

      const [server] = await db
        .select({
          id: workflowMcpServer.id,
          workspaceId: workflowMcpServer.workspaceId,
          createdBy: workflowMcpServer.createdBy,
          name: workflowMcpServer.name,
          description: workflowMcpServer.description,
          isPublic: workflowMcpServer.isPublic,
          createdAt: workflowMcpServer.createdAt,
          updatedAt: workflowMcpServer.updatedAt,
        })
        .from(workflowMcpServer)
        .where(
          and(
            eq(workflowMcpServer.id, serverId),
            eq(workflowMcpServer.workspaceId, workspaceId),
            isNull(workflowMcpServer.deletedAt)
          )
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const tools = await db
        .select()
        .from(workflowMcpTool)
        .where(and(eq(workflowMcpTool.serverId, serverId), isNull(workflowMcpTool.archivedAt)))

      logger.info(`Found workflow MCP server: ${server.name} with ${tools.length} tools`, {
        requestId,
      })

      return createMcpSuccessResponse({ server, tools })
    } catch (error) {
      logger.error('Error getting workflow MCP server:', error, { requestId })
      return createMcpErrorResponse(toError(error), 'Failed to get workflow MCP server', 500)
    }
  })
)

/**
 * PATCH - Update a workflow MCP server
 */
export const PATCH = withRouteHandler(
  withMcpAuth<RouteParams>(
    'write',
    'deploy.mcp'
  )(
    async (
      request: NextRequest,
      { userId, userName, userEmail, workspaceId, requestId, permission },
      { params }
    ) => {
      try {
        const { id: serverId } = workflowMcpServerParamsSchema.parse(await params)
        const rawBody = await readMcpJsonBodyWithLimit(request)
        const parsedBody = updateWorkflowMcpServerBodySchema.safeParse(rawBody)

        if (!parsedBody.success) {
          return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
        }

        const body = parsedBody.data

        logger.info(`Updating workflow MCP server: ${serverId}`, { requestId })

        const result = await performUpdateWorkflowMcpServer({
          serverId,
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          name: body.name,
          description: body.description,
          isPublic: body.isPublic,
          allowVisibilityChange: permission === 'admin',
        })
        if (!result.success || !result.server) {
          const status = mcpOrchestrationStatus(result.errorCode)
          return createMcpErrorResponse(
            new Error(result.error || 'Failed to update workflow MCP server'),
            result.error || 'Failed to update workflow MCP server',
            status
          )
        }

        const updatedServer = result.server

        logger.info(`Successfully updated workflow MCP server: ${serverId}`, { requestId })

        return createMcpSuccessResponse({ server: updatedServer })
      } catch (error) {
        const bodyErrorResponse = mcpBodyReadErrorResponse(error, request)
        if (bodyErrorResponse) return bodyErrorResponse
        logger.error('Error updating workflow MCP server:', error, { requestId })
        return createMcpErrorResponse(toError(error), 'Failed to update workflow MCP server', 500)
      }
    }
  )
)

/**
 * DELETE - Delete a workflow MCP server and all its tools
 */
export const DELETE = withRouteHandler(
  withMcpAuth<RouteParams>(
    'write',
    'deploy.mcp'
  )(
    async (
      _request: NextRequest,
      { userId, userName, userEmail, workspaceId, requestId },
      { params }
    ) => {
      try {
        const { id: serverId } = workflowMcpServerParamsSchema.parse(await params)

        logger.info(`Deleting workflow MCP server: ${serverId}`, { requestId })

        const result = await performDeleteWorkflowMcpServer({
          serverId,
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
        })
        if (!result.success || !result.server) {
          return createMcpErrorResponse(
            new Error(result.error || 'Server not found'),
            result.error || 'Server not found',
            mcpOrchestrationStatus(result.errorCode)
          )
        }
        logger.info(`Successfully deleted workflow MCP server: ${serverId}`, { requestId })

        return createMcpSuccessResponse({ message: `Server ${serverId} deleted successfully` })
      } catch (error) {
        logger.error('Error deleting workflow MCP server:', error, { requestId })
        return createMcpErrorResponse(toError(error), 'Failed to delete workflow MCP server', 500)
      }
    }
  )
)
