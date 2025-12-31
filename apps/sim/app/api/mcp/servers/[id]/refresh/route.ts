import { db } from '@sim/db'
import { mcpServers, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import type { McpServerStatusConfig, McpTool, McpToolSchema } from '@/lib/mcp/types'
import {
  createMcpErrorResponse,
  createMcpSuccessResponse,
  MCP_TOOL_CORE_PARAMS,
} from '@/lib/mcp/utils'

const logger = createLogger('McpServerRefreshAPI')

export const dynamic = 'force-dynamic'

/** Schema stored in workflow blocks includes description from the tool. */
type StoredToolSchema = McpToolSchema & { description?: string }

interface StoredTool {
  type: string
  title: string
  toolId: string
  params: {
    serverId: string
    serverUrl?: string
    toolName: string
    serverName?: string
  }
  schema?: StoredToolSchema
  [key: string]: unknown
}

interface SyncResult {
  updatedCount: number
  updatedWorkflowIds: string[]
}

/**
 * Syncs tool schemas from discovered MCP tools to all workflow blocks using those tools.
 * Returns the count and IDs of updated workflows.
 */
async function syncToolSchemasToWorkflows(
  workspaceId: string,
  serverId: string,
  tools: McpTool[],
  requestId: string
): Promise<SyncResult> {
  const toolsByName = new Map(tools.map((t) => [t.name, t]))

  const workspaceWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(eq(workflow.workspaceId, workspaceId))

  const workflowIds = workspaceWorkflows.map((w) => w.id)
  if (workflowIds.length === 0) return { updatedCount: 0, updatedWorkflowIds: [] }

  const agentBlocks = await db
    .select({
      id: workflowBlocks.id,
      workflowId: workflowBlocks.workflowId,
      subBlocks: workflowBlocks.subBlocks,
    })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.type, 'agent'))

  const updatedWorkflowIds = new Set<string>()

  for (const block of agentBlocks) {
    if (!workflowIds.includes(block.workflowId)) continue

    const subBlocks = block.subBlocks as Record<string, unknown> | null
    if (!subBlocks) continue

    const toolsSubBlock = subBlocks.tools as { value?: StoredTool[] } | undefined
    if (!toolsSubBlock?.value || !Array.isArray(toolsSubBlock.value)) continue

    let hasUpdates = false
    const updatedTools = toolsSubBlock.value.map((tool) => {
      if (tool.type !== 'mcp' || tool.params?.serverId !== serverId) {
        return tool
      }

      const freshTool = toolsByName.get(tool.params.toolName)
      if (!freshTool) return tool

      const newSchema: StoredToolSchema = {
        ...freshTool.inputSchema,
        description: freshTool.description,
      }

      const schemasMatch = JSON.stringify(tool.schema) === JSON.stringify(newSchema)

      if (!schemasMatch) {
        hasUpdates = true

        const validParamKeys = new Set(Object.keys(newSchema.properties || {}))

        const cleanedParams: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(tool.params || {})) {
          if (MCP_TOOL_CORE_PARAMS.has(key) || validParamKeys.has(key)) {
            cleanedParams[key] = value
          }
        }

        return { ...tool, schema: newSchema, params: cleanedParams }
      }

      return tool
    })

    if (hasUpdates) {
      const updatedSubBlocks = {
        ...subBlocks,
        tools: { ...toolsSubBlock, value: updatedTools },
      }

      await db
        .update(workflowBlocks)
        .set({ subBlocks: updatedSubBlocks, updatedAt: new Date() })
        .where(eq(workflowBlocks.id, block.id))

      updatedWorkflowIds.add(block.workflowId)
    }
  }

  if (updatedWorkflowIds.size > 0) {
    logger.info(
      `[${requestId}] Synced tool schemas to ${updatedWorkflowIds.size} workflow(s) for server ${serverId}`
    )
  }

  return {
    updatedCount: updatedWorkflowIds.size,
    updatedWorkflowIds: Array.from(updatedWorkflowIds),
  }
}

export const POST = withMcpAuth<{ id: string }>('read')(
  async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
    const { id: serverId } = await params

    try {
      logger.info(`[${requestId}] Refreshing MCP server: ${serverId}`)

      const [server] = await db
        .select()
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

      if (!server) {
        return createMcpErrorResponse(
          new Error('Server not found or access denied'),
          'Server not found',
          404
        )
      }

      let connectionStatus: 'connected' | 'disconnected' | 'error' = 'error'
      let toolCount = 0
      let lastError: string | null = null
      let syncResult: SyncResult = { updatedCount: 0, updatedWorkflowIds: [] }
      let discoveredTools: McpTool[] = []

      const currentStatusConfig: McpServerStatusConfig =
        (server.statusConfig as McpServerStatusConfig | null) ?? {
          consecutiveFailures: 0,
          lastSuccessfulDiscovery: null,
        }

      try {
        discoveredTools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
        connectionStatus = 'connected'
        toolCount = discoveredTools.length
        logger.info(`[${requestId}] Discovered ${toolCount} tools from server ${serverId}`)

        syncResult = await syncToolSchemasToWorkflows(
          workspaceId,
          serverId,
          discoveredTools,
          requestId
        )
      } catch (error) {
        connectionStatus = 'error'
        lastError = error instanceof Error ? error.message : 'Connection test failed'
        logger.warn(`[${requestId}] Failed to connect to server ${serverId}:`, error)
      }

      const now = new Date()
      const newStatusConfig =
        connectionStatus === 'connected'
          ? { consecutiveFailures: 0, lastSuccessfulDiscovery: now.toISOString() }
          : {
              consecutiveFailures: currentStatusConfig.consecutiveFailures + 1,
              lastSuccessfulDiscovery: currentStatusConfig.lastSuccessfulDiscovery,
            }

      const [refreshedServer] = await db
        .update(mcpServers)
        .set({
          lastToolsRefresh: now,
          connectionStatus,
          lastError,
          lastConnected: connectionStatus === 'connected' ? now : server.lastConnected,
          toolCount,
          statusConfig: newStatusConfig,
          updatedAt: now,
        })
        .where(eq(mcpServers.id, serverId))
        .returning()

      if (connectionStatus === 'connected') {
        await mcpService.clearCache(workspaceId)
      }

      return createMcpSuccessResponse({
        status: connectionStatus,
        toolCount,
        lastConnected: refreshedServer?.lastConnected?.toISOString() || null,
        error: lastError,
        workflowsUpdated: syncResult.updatedCount,
        updatedWorkflowIds: syncResult.updatedWorkflowIds,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing MCP server:`, error)
      return createMcpErrorResponse(
        error instanceof Error ? error : new Error('Failed to refresh MCP server'),
        'Failed to refresh MCP server',
        500
      )
    }
  }
)
