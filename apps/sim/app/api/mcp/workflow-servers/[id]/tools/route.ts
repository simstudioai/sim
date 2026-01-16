import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'

const logger = createLogger('WorkflowMcpToolsAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  id: string
}

/**
 * GET - List all tools for a workflow MCP server
 */
export const GET = withMcpAuth<RouteParams>('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params

      logger.info(`[${requestId}] Listing tools for workflow MCP server: ${serverId}`)

      const [server] = await db
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
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
        .leftJoin(workflow, eq(workflowMcpTool.workflowId, workflow.id))
        .where(eq(workflowMcpTool.serverId, serverId))

      logger.info(`[${requestId}] Found ${tools.length} tools for server ${serverId}`)

      return createMcpSuccessResponse({ tools })
    } catch (error) {
      logger.error(`[${requestId}] Error listing tools:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to list tools'),
        'Failed to list tools',
        500
      )
    }
  }
)

/**
 * POST - Add a workflow as a tool to an MCP server
 */
export const POST = withMcpAuth<RouteParams>('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    try {
      const { id: serverId } = await params
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Adding tool to workflow MCP server: ${serverId}`, {
        workflowId: body.workflowId,
      })

      if (!body.workflowId) {
        return createMcpErrorResponse(
          new Error('Missing required field: workflowId'),
          'Missing required field',
          400
        )
      }

      const [server] = await db
        .select({ id: workflowMcpServer.id })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }

      const [workflowRecord] = await db
        .select({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          isDeployed: workflow.isDeployed,
          workspaceId: workflow.workspaceId,
        })
        .from(workflow)
        .where(eq(workflow.id, body.workflowId))
        .limit(1)

      if (!workflowRecord) {
        return createMcpErrorResponse(new Error('Workflow not found'), 'Workflow not found', 404)
      }

      if (workflowRecord.workspaceId !== workspaceId) {
        return createMcpErrorResponse(
          new Error('Workflow does not belong to this workspace'),
          'Access denied',
          403
        )
      }

      if (!workflowRecord.isDeployed) {
        return createMcpErrorResponse(
          new Error('Workflow must be deployed before adding as a tool'),
          'Workflow not deployed',
          400
        )
      }

      const hasStartBlock = await hasValidStartBlock(body.workflowId)
      if (!hasStartBlock) {
        return createMcpErrorResponse(
          new Error('Workflow must have a Start block to be used as an MCP tool'),
          'No start block found',
          400
        )
      }

      const [existingTool] = await db
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(
          and(
            eq(workflowMcpTool.serverId, serverId),
            eq(workflowMcpTool.workflowId, body.workflowId)
          )
        )
        .limit(1)

      if (existingTool) {
        return createMcpErrorResponse(
          new Error('This workflow is already added as a tool to this server'),
          'Tool already exists',
          409
        )
      }

      const toolName = sanitizeToolName(body.toolName?.trim() || workflowRecord.name)
      const toolDescription =
        body.toolDescription?.trim() ||
        workflowRecord.description ||
        `Execute ${workflowRecord.name} workflow`

      const toolId = crypto.randomUUID()
      const [tool] = await db
        .insert(workflowMcpTool)
        .values({
          id: toolId,
          serverId,
          workflowId: body.workflowId,
          toolName,
          toolDescription,
          parameterSchema: body.parameterSchema || {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      logger.info(
        `[${requestId}] Successfully added tool ${toolName} (workflow: ${body.workflowId}) to server ${serverId}`
      )

      return createMcpSuccessResponse({ tool }, 201)
    } catch (error) {
      logger.error(`[${requestId}] Error adding tool:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to add tool'),
        'Failed to add tool',
        500
      )
    }
  }
)
