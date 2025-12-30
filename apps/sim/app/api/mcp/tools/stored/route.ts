import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { withMcpAuth } from '@/lib/mcp/middleware'
import type { McpToolSchema, StoredMcpTool } from '@/lib/mcp/types'
import { createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpStoredToolsAPI')

export const dynamic = 'force-dynamic'

export const GET = withMcpAuth('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      logger.info(`[${requestId}] Fetching stored MCP tools for workspace ${workspaceId}`)

      const workflows = await db
        .select({ id: workflow.id, name: workflow.name })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      const workflowMap = new Map(workflows.map((w) => [w.id, w.name]))
      const workflowIds = workflows.map((w) => w.id)

      if (workflowIds.length === 0) {
        return createMcpSuccessResponse({ tools: [] })
      }

      const agentBlocks = await db
        .select({ workflowId: workflowBlocks.workflowId, subBlocks: workflowBlocks.subBlocks })
        .from(workflowBlocks)
        .where(eq(workflowBlocks.type, 'agent'))

      const storedTools: StoredMcpTool[] = []

      for (const block of agentBlocks) {
        if (!workflowMap.has(block.workflowId)) continue

        const subBlocks = block.subBlocks as Record<string, unknown> | null
        if (!subBlocks) continue

        const toolsSubBlock = subBlocks.tools as Record<string, unknown> | undefined
        const toolsValue = toolsSubBlock?.value

        if (!toolsValue || !Array.isArray(toolsValue)) continue

        for (const tool of toolsValue) {
          if (tool.type !== 'mcp') continue

          const params = tool.params as Record<string, unknown> | undefined
          if (!params?.serverId || !params?.toolName) continue

          storedTools.push({
            workflowId: block.workflowId,
            workflowName: workflowMap.get(block.workflowId) || 'Untitled',
            serverId: params.serverId as string,
            serverUrl: params.serverUrl as string | undefined,
            toolName: params.toolName as string,
            schema: tool.schema as McpToolSchema | undefined,
          })
        }
      }

      logger.info(
        `[${requestId}] Found ${storedTools.length} stored MCP tools across ${workflows.length} workflows`
      )

      return createMcpSuccessResponse({ tools: storedTools })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching stored MCP tools:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to fetch stored MCP tools'),
        'Failed to fetch stored MCP tools',
        500
      )
    }
  }
)
