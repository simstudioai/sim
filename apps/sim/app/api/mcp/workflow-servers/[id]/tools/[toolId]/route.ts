import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  updateWorkflowMcpToolBodySchema,
  workflowMcpToolParamsSchema,
} from '@/lib/api/contracts/workflow-mcp-servers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { performDeleteWorkflowMcpTool, performUpdateWorkflowMcpTool } from '@/lib/mcp/orchestration'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpToolAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
  toolId: string
}

/**
 * GET - Get a specific tool
 */
export const GET = withRouteHandler(
  withMcpAuth<RouteParams>('read')(
    async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
      try {
        const { id: serverId, toolId } = workflowMcpToolParamsSchema.parse(await params)

        logger.info(`[${requestId}] Getting tool ${toolId} from server ${serverId}`)

        const [server] = await db
          .select({ id: workflowMcpServer.id })
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

        const [tool] = await db
          .select()
          .from(workflowMcpTool)
          .where(
            and(
              eq(workflowMcpTool.id, toolId),
              eq(workflowMcpTool.serverId, serverId),
              isNull(workflowMcpTool.archivedAt)
            )
          )
          .limit(1)

        if (!tool) {
          return createMcpErrorResponse(new Error('Tool not found'), 'Tool not found', 404)
        }

        return createMcpSuccessResponse({ tool })
      } catch (error) {
        logger.error(`[${requestId}] Error getting tool:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to get tool', 500)
      }
    }
  )
)

/**
 * PATCH - Update a tool's configuration
 */
export const PATCH = withRouteHandler(
  withMcpAuth<RouteParams>('write')(
    async (
      request: NextRequest,
      { userId, userName, userEmail, workspaceId, requestId },
      { params }
    ) => {
      try {
        const { id: serverId, toolId } = workflowMcpToolParamsSchema.parse(await params)
        const rawBody = getParsedBody(request) ?? (await request.json())
        const parsedBody = updateWorkflowMcpToolBodySchema.safeParse(rawBody)

        if (!parsedBody.success) {
          return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
        }

        const body = parsedBody.data

        logger.info(`[${requestId}] Updating tool ${toolId} in server ${serverId}`)

        const result = await performUpdateWorkflowMcpTool({
          serverId,
          toolId,
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          toolName: body.toolName,
          toolDescription: body.toolDescription,
          parameterSchema: body.parameterSchema,
        })
        if (!result.success || !result.tool) {
          const status =
            result.errorCode === 'not_found' ? 404 : result.errorCode === 'validation' ? 400 : 500
          return createMcpErrorResponse(
            new Error(result.error || 'Failed to update tool'),
            result.error || 'Failed to update tool',
            status
          )
        }

        const updatedTool = result.tool

        logger.info(`[${requestId}] Successfully updated tool ${toolId}`)

        return createMcpSuccessResponse({ tool: updatedTool })
      } catch (error) {
        logger.error(`[${requestId}] Error updating tool:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to update tool', 500)
      }
    }
  )
)

/**
 * DELETE - Remove a tool from an MCP server
 */
export const DELETE = withRouteHandler(
  withMcpAuth<RouteParams>('write')(
    async (
      request: NextRequest,
      { userId, userName, userEmail, workspaceId, requestId },
      { params }
    ) => {
      try {
        const { id: serverId, toolId } = workflowMcpToolParamsSchema.parse(await params)

        logger.info(`[${requestId}] Deleting tool ${toolId} from server ${serverId}`)

        const result = await performDeleteWorkflowMcpTool({
          serverId,
          toolId,
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
        })
        if (!result.success || !result.tool) {
          return createMcpErrorResponse(
            new Error(result.error || 'Tool not found'),
            result.error || 'Tool not found',
            result.errorCode === 'not_found' ? 404 : 500
          )
        }
        const deletedTool = result.tool

        logger.info(`[${requestId}] Successfully deleted tool ${toolId}`)

        return createMcpSuccessResponse({ message: `Tool ${toolId} deleted successfully` })
      } catch (error) {
        logger.error(`[${requestId}] Error deleting tool:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to delete tool', 500)
      }
    }
  )
)
