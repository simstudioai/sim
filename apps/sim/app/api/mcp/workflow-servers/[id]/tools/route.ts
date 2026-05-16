import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  createWorkflowMcpToolBodySchema,
  workflowMcpServerParamsSchema,
} from '@/lib/api/contracts/workflow-mcp-servers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { performCreateWorkflowMcpTool } from '@/lib/mcp/orchestration'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  mcpOrchestrationStatus,
} from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpToolsAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
}

/**
 * GET - List all tools for a workflow MCP server
 */
export const GET = withRouteHandler(
  withMcpAuth<RouteParams>('read')(
    async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
      try {
        const { id: serverId } = workflowMcpServerParamsSchema.parse(await params)

        logger.info(`[${requestId}] Listing tools for workflow MCP server: ${serverId}`)

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

        const tools = await db
          .select({
            id: workflowMcpTool.id,
            serverId: workflowMcpTool.serverId,
            workflowId: workflowMcpTool.workflowId,
            toolName: workflowMcpTool.toolName,
            toolDescription: workflowMcpTool.toolDescription,
            parameterSchema: workflowMcpTool.parameterSchema,
            createdAt: workflowMcpTool.createdAt,
            updatedAt: workflowMcpTool.updatedAt,
            workflowName: workflow.name,
            workflowDescription: workflow.description,
            isDeployed: workflow.isDeployed,
          })
          .from(workflowMcpTool)
          .leftJoin(
            workflow,
            and(eq(workflowMcpTool.workflowId, workflow.id), isNull(workflow.archivedAt))
          )
          .where(and(eq(workflowMcpTool.serverId, serverId), isNull(workflowMcpTool.archivedAt)))

        logger.info(`[${requestId}] Found ${tools.length} tools for server ${serverId}`)

        return createMcpSuccessResponse({ tools })
      } catch (error) {
        logger.error(`[${requestId}] Error listing tools:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to list tools', 500)
      }
    }
  )
)

/**
 * POST - Add a workflow as a tool to an MCP server
 */
export const POST = withRouteHandler(
  withMcpAuth<RouteParams>('write')(
    async (
      request: NextRequest,
      { userId, userName, userEmail, workspaceId, requestId },
      { params }
    ) => {
      try {
        const { id: serverId } = workflowMcpServerParamsSchema.parse(await params)
        const rawBody = getParsedBody(request) ?? (await request.json())
        const parsedBody = createWorkflowMcpToolBodySchema.safeParse(rawBody)

        if (!parsedBody.success) {
          return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
        }

        const body = parsedBody.data

        logger.info(`[${requestId}] Adding tool to workflow MCP server: ${serverId}`, {
          workflowId: body.workflowId,
        })

        const result = await performCreateWorkflowMcpTool({
          serverId,
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          workflowId: body.workflowId,
          toolName: body.toolName,
          toolDescription: body.toolDescription,
          parameterSchema: body.parameterSchema,
        })
        if (!result.success || !result.tool) {
          return createMcpErrorResponse(
            new Error(result.error || 'Failed to add tool'),
            result.error || 'Failed to add tool',
            mcpOrchestrationStatus(result.errorCode)
          )
        }

        const tool = result.tool

        logger.info(
          `[${requestId}] Successfully added tool ${tool.toolName} (workflow: ${body.workflowId}) to server ${serverId}`
        )

        return createMcpSuccessResponse({ tool }, 201)
      } catch (error) {
        logger.error(`[${requestId}] Error adding tool:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to add tool', 500)
      }
    }
  )
)
