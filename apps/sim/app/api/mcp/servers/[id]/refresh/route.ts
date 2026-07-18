import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { db } from '@sim/db'
import { mcpServers, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { mcpServerIdParamsSchema } from '@/lib/api/contracts/mcp'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { type McpServerDiscoveryState, mcpService } from '@/lib/mcp/service'
import {
  McpOauthAuthorizationRequiredError,
  type McpTool,
  type McpToolSchema,
} from '@/lib/mcp/types'
import {
  categorizeError,
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

interface ServerMetadata {
  url?: string
  name?: string
}

/**
 * Syncs tool schemas and server metadata from discovered MCP tools to all
 * workflow blocks using those tools. Updates stored serverUrl/serverName
 * when the server's details have changed, preventing stale badges after
 * a server URL edit.
 */
async function syncToolSchemasToWorkflows(
  workspaceId: string,
  serverId: string,
  tools: McpTool[],
  requestId: string,
  serverMeta?: ServerMetadata
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
    .where(and(eq(workflowBlocks.type, 'agent'), inArray(workflowBlocks.workflowId, workflowIds)))

  const updatedWorkflowIds = new Set<string>()

  for (const block of agentBlocks) {
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

      const urlChanged = serverMeta?.url != null && tool.params.serverUrl !== serverMeta.url
      const nameChanged = serverMeta?.name != null && tool.params.serverName !== serverMeta.name

      if (!schemasMatch || urlChanged || nameChanged) {
        hasUpdates = true

        const validParamKeys = new Set(Object.keys(newSchema.properties || {}))

        const cleanedParams: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(tool.params || {})) {
          if (MCP_TOOL_CORE_PARAMS.has(key) || validParamKeys.has(key)) {
            cleanedParams[key] = value
          }
        }

        if (urlChanged) cleanedParams.serverUrl = serverMeta.url
        if (nameChanged) cleanedParams.serverName = serverMeta.name

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

export const POST = withRouteHandler(
  withMcpAuth<{ id: string }>('read')(
    async (request: NextRequest, { userId, workspaceId, requestId }, { params }) => {
      try {
        const paramsValidation = mcpServerIdParamsSchema.safeParse(await params)
        if (!paramsValidation.success) return validationErrorResponse(paramsValidation.error)
        const { id: serverId } = paramsValidation.data
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

        let syncResult: SyncResult = { updatedCount: 0, updatedWorkflowIds: [] }
        let discoveredTools: McpTool[] = []
        let discoveryState: McpServerDiscoveryState | null = null
        let discoveryError: string | null = null
        let oauthAuthorizationRequired = false

        try {
          const discovery = await mcpService.discoverServerToolsWithMetadata(
            userId,
            serverId,
            workspaceId,
            true
          )
          discoveredTools = discovery.tools
          discoveryState = discovery.state
          logger.info(
            `[${requestId}] Discovered ${discoveredTools.length} tools from server ${serverId}`
          )
        } catch (error) {
          oauthAuthorizationRequired =
            server.authType === 'oauth' &&
            (error instanceof McpOauthAuthorizationRequiredError ||
              error instanceof UnauthorizedError)
          discoveryError = truncate(categorizeError(error).message, 200, '')
          logger.warn(`[${requestId}] Failed to connect to server ${serverId}`, {
            error: discoveryError,
          })
        }

        const [refreshedServer] = await db
          .select({
            name: mcpServers.name,
            url: mcpServers.url,
            connectionStatus: mcpServers.connectionStatus,
            lastConnected: mcpServers.lastConnected,
            lastToolsRefresh: mcpServers.lastToolsRefresh,
            lastError: mcpServers.lastError,
            toolCount: mcpServers.toolCount,
          })
          .from(mcpServers)
          .where(
            and(
              eq(mcpServers.id, serverId),
              eq(mcpServers.workspaceId, workspaceId),
              isNull(mcpServers.deletedAt)
            )
          )
          .limit(1)

        if (discoveryError === null && discoveryState === 'published') {
          try {
            syncResult = await syncToolSchemasToWorkflows(
              workspaceId,
              serverId,
              discoveredTools,
              requestId,
              {
                url: refreshedServer?.url ?? undefined,
                name: refreshedServer?.name ?? undefined,
              }
            )
          } catch (error) {
            // Discovery already persisted status and cached tools; a workflow-sync
            // failure is a secondary propagation and must not fail the refresh with
            // a 500. Surface it as zero workflows updated instead.
            logger.warn(`[${requestId}] Tool schema sync failed after successful discovery`, {
              error: getErrorMessage(error),
            })
          }
        }

        let connectionStatus = refreshedServer?.connectionStatus ?? 'error'
        let lastError = refreshedServer ? refreshedServer.lastError : discoveryError
        let toolCount = refreshedServer?.toolCount ?? discoveredTools.length
        const newerSuccessWonRace =
          connectionStatus === 'connected' &&
          refreshedServer?.lastToolsRefresh != null &&
          (server.lastToolsRefresh == null ||
            refreshedServer.lastToolsRefresh > server.lastToolsRefresh) &&
          refreshedServer.lastConnected != null &&
          (server.lastConnected == null || refreshedServer.lastConnected > server.lastConnected)

        if (discoveryState === 'superseded' && !newerSuccessWonRace) {
          connectionStatus = 'disconnected'
          lastError = 'Tool discovery was superseded by a newer refresh. Please retry.'
          toolCount = 0
        } else if (
          discoveryError === null &&
          (discoveryState === 'unavailable' || discoveryState === 'winner-cache')
        ) {
          connectionStatus = 'connected'
          lastError = null
          toolCount = discoveredTools.length
        }

        if (discoveryError !== null && connectionStatus === 'connected') {
          if (!newerSuccessWonRace) {
            connectionStatus = 'disconnected'
            lastError = oauthAuthorizationRequired ? null : discoveryError
            toolCount = 0
          }
        } else if (
          discoveryError !== null &&
          connectionStatus === 'disconnected' &&
          lastError === null &&
          !oauthAuthorizationRequired
        ) {
          lastError = discoveryError
          toolCount = 0
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
        return createMcpErrorResponse(toError(error), 'Failed to refresh MCP server', 500)
      }
    }
  )
)
