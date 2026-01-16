import { db } from '@sim/db'
import { workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, inArray, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getParsedBody, withMcpAuth } from '@/lib/mcp/middleware'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'

const logger = createLogger('WorkflowMcpServersAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all workflow MCP servers for the workspace
 */
export const GET = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
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
          )`.as('tool_count'),
        })
        .from(workflowMcpServer)
        .where(eq(workflowMcpServer.workspaceId, workspaceId))

      const serverIds = servers.map((s) => s.id)
      const tools =
        serverIds.length > 0
          ? await db
              .select({
                serverId: workflowMcpTool.serverId,
                toolName: workflowMcpTool.toolName,
              })
              .from(workflowMcpTool)
              .where(inArray(workflowMcpTool.serverId, serverIds))
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
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to list workflow MCP servers'),
        'Failed to list workflow MCP servers',
        500
      )
    }
  }
)

/**
 * POST - Create a new workflow MCP server
 */
export const POST = withMcpAuth('write')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const body = getParsedBody(request) || (await request.json())

      logger.info(`[${requestId}] Creating workflow MCP server:`, {
        name: body.name,
        workspaceId,
        workflowIds: body.workflowIds,
      })

      if (!body.name) {
        return createMcpErrorResponse(
          new Error('Missing required field: name'),
          'Missing required field',
          400
        )
      }

      const serverId = crypto.randomUUID()

      const [server] = await db
        .insert(workflowMcpServer)
        .values({
          id: serverId,
          workspaceId,
          createdBy: userId,
          name: body.name.trim(),
          description: body.description?.trim() || null,
          isPublic: body.isPublic ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()

      const workflowIds: string[] = body.workflowIds || []
      const addedTools: Array<{ workflowId: string; toolName: string }> = []

      if (workflowIds.length > 0) {
        const workflows = await db
          .select({
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            isDeployed: workflow.isDeployed,
            workspaceId: workflow.workspaceId,
          })
          .from(workflow)
          .where(inArray(workflow.id, workflowIds))

        for (const workflowRecord of workflows) {
          if (workflowRecord.workspaceId !== workspaceId) {
            logger.warn(
              `[${requestId}] Skipping workflow ${workflowRecord.id} - does not belong to workspace`
            )
            continue
          }

          if (!workflowRecord.isDeployed) {
            logger.warn(`[${requestId}] Skipping workflow ${workflowRecord.id} - not deployed`)
            continue
          }

          const hasStartBlock = await hasValidStartBlock(workflowRecord.id)
          if (!hasStartBlock) {
            logger.warn(`[${requestId}] Skipping workflow ${workflowRecord.id} - no start block`)
            continue
          }

          const toolName = sanitizeToolName(workflowRecord.name)
          const toolDescription =
            workflowRecord.description || `Execute ${workflowRecord.name} workflow`

          const toolId = crypto.randomUUID()
          await db.insert(workflowMcpTool).values({
            id: toolId,
            serverId,
            workflowId: workflowRecord.id,
            toolName,
            toolDescription,
            parameterSchema: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          })

          addedTools.push({ workflowId: workflowRecord.id, toolName })
        }

        logger.info(
          `[${requestId}] Added ${addedTools.length} tools to server ${serverId}:`,
          addedTools.map((t) => t.toolName)
        )
      }

      logger.info(
        `[${requestId}] Successfully created workflow MCP server: ${body.name} (ID: ${serverId})`
      )

      return createMcpSuccessResponse({ server, addedTools }, 201)
    } catch (error) {
      logger.error(`[${requestId}] Error creating workflow MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to create workflow MCP server'),
        'Failed to create workflow MCP server',
        500
      )
    }
  }
)
