import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createWorkflowMcpServerBodySchema } from '@/lib/api/contracts/workflow-mcp-servers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { performCreateWorkflowMcpServer } from '@/lib/mcp/orchestration'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  mcpOrchestrationStatus,
} from '@/lib/mcp/utils'

const logger = createLogger('WorkflowMcpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all workflow MCP servers for the workspace
 */
export const GET = withRouteHandler(
  withMcpAuth('read')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      logger.info(`[${requestId}] Listing workflow MCP servers for workspace ${workspaceId}`)

      const servers = await db
        .select({
          id: workflowMcpServer.id,
          workspaceId: workflowMcpServer.workspaceId,
          createdBy: workflowMcpServer.createdBy,
          name: workflowMcpServer.name,
          description: workflowMcpServer.description,
          isPublic: workflowMcpServer.isPublic,
          createdAt: workflowMcpServer.createdAt,
          updatedAt: workflowMcpServer.updatedAt,
          toolCount: sql<number>`(
            SELECT COUNT(*)::int
            FROM "workflow_mcp_tool"
            WHERE "workflow_mcp_tool"."server_id" = "workflow_mcp_server"."id"
              AND "workflow_mcp_tool"."archived_at" IS NULL
          )`.as('tool_count'),
        })
        .from(workflowMcpServer)
        .where(
          and(eq(workflowMcpServer.workspaceId, workspaceId), isNull(workflowMcpServer.deletedAt))
        )

      const serverIds = servers.map((s) => s.id)
      const tools =
        serverIds.length > 0
          ? await db
              .select({
                serverId: workflowMcpTool.serverId,
                toolName: workflowMcpTool.toolName,
              })
              .from(workflowMcpTool)
              .where(
                and(
                  inArray(workflowMcpTool.serverId, serverIds),
                  isNull(workflowMcpTool.archivedAt)
                )
              )
          : []

      const toolNamesByServer: Record<string, string[]> = {}
      for (const tool of tools) {
        if (!toolNamesByServer[tool.serverId]) {
          toolNamesByServer[tool.serverId] = []
        }
        toolNamesByServer[tool.serverId].push(tool.toolName)
      }

      const serversWithToolNames = servers.map((server) => ({
        ...server,
        toolNames: toolNamesByServer[server.id] || [],
      }))

      logger.info(
        `[${requestId}] Listed ${servers.length} workflow MCP servers for workspace ${workspaceId}`
      )
      return createMcpSuccessResponse({ servers: serversWithToolNames })
    } catch (error) {
      logger.error(`[${requestId}] Error listing workflow MCP servers:`, error)
      return createMcpErrorResponse(toError(error), 'Failed to list workflow MCP servers', 500)
    }
  })
)

/**
 * POST - Create a new workflow MCP server
 */
export const POST = withRouteHandler(
  withMcpAuth('write')(
    async (request: NextRequest, { userId, userName, userEmail, workspaceId, requestId }) => {
      try {
        const rawBody = getParsedBody(request) ?? (await request.json())
        const parsedBody = createWorkflowMcpServerBodySchema.safeParse(rawBody)

        if (!parsedBody.success) {
          return createMcpErrorResponse(parsedBody.error, 'Invalid request format', 400)
        }

        const body = parsedBody.data

        logger.info(`[${requestId}] Creating workflow MCP server:`, {
          name: body.name,
          workspaceId,
          workflowIds: body.workflowIds,
        })

        const result = await performCreateWorkflowMcpServer({
          workspaceId,
          userId,
          actorName: userName,
          actorEmail: userEmail,
          name: body.name,
          description: body.description,
          isPublic: body.isPublic,
          workflowIds: body.workflowIds,
        })
        if (!result.success || !result.server) {
          return createMcpErrorResponse(
            new Error(result.error || 'Failed to create workflow MCP server'),
            result.error || 'Failed to create workflow MCP server',
            mcpOrchestrationStatus(result.errorCode)
          )
        }

        const { server } = result
        const addedTools = result.addedTools || []

        logger.info(
          `[${requestId}] Successfully created workflow MCP server: ${body.name} (ID: ${server.id})`
        )

        return createMcpSuccessResponse({ server, addedTools }, 201)
      } catch (error) {
        logger.error(`[${requestId}] Error creating workflow MCP server:`, error)
        return createMcpErrorResponse(toError(error), 'Failed to create workflow MCP server', 500)
      }
    }
  )
)
