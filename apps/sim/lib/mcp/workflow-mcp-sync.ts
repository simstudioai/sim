import { db, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_MCP_SERVERS_PER_WORKFLOW } from '@/lib/mcp/constants'
import { acquireWorkflowMcpServerLock } from '@/lib/mcp/server-locks'
import {
  addMcpToolMetadataUsageRow,
  createMcpToolMetadataUsageRow,
  exceedsMcpServerToolMetadataBudget,
  getMcpServerToolMetadataUsageRows,
  getMcpToolMetadataUsageFromRows,
  type McpToolMetadataUsage,
  type McpToolMetadataUsageRow,
  subtractMcpToolMetadataUsageRow,
  validateMcpToolMetadataForStorage,
} from '@/lib/mcp/tool-limits'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { mcpPubSub } from './pubsub'
import { extractInputFormatFromBlocks, generateToolInputSchema } from './workflow-tool-schema'

const logger = createLogger('WorkflowMcpSync')

const EMPTY_SCHEMA: Record<string, unknown> = Object.freeze({ type: 'object', properties: {} })
const MCP_SYNC_TOOLS_PAGE_SIZE = 100

class WorkflowMcpServerFanoutError extends Error {
  constructor(workflowId: string) {
    super(
      `Workflow ${workflowId} is exposed on more than ${MAX_MCP_SERVERS_PER_WORKFLOW} MCP servers`
    )
    this.name = 'WorkflowMcpServerFanoutError'
  }
}

interface WorkflowMcpToolSyncRow {
  id: string
  serverId: string
  toolName: string
  toolDescription: string | null
}

interface ServerMetadataUsageState {
  usageByToolId: Map<string, McpToolMetadataUsageRow>
  serverUsage: McpToolMetadataUsage
}

async function listWorkflowMcpToolSyncPage(
  tx: DbOrTx,
  workflowId: string,
  afterToolId?: string,
  serverIds?: string[]
): Promise<WorkflowMcpToolSyncRow[]> {
  return tx
    .select({
      id: workflowMcpTool.id,
      serverId: workflowMcpTool.serverId,
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
    })
    .from(workflowMcpTool)
    .where(
      and(
        eq(workflowMcpTool.workflowId, workflowId),
        isNull(workflowMcpTool.archivedAt),
        serverIds && serverIds.length > 0
          ? inArray(workflowMcpTool.serverId, serverIds)
          : undefined,
        afterToolId ? gt(workflowMcpTool.id, afterToolId) : undefined
      )
    )
    .orderBy(asc(workflowMcpTool.id))
    .limit(MCP_SYNC_TOOLS_PAGE_SIZE + 1)
}

async function collectWorkflowMcpToolServerIds(
  tx: DbOrTx,
  workflowId: string
): Promise<Array<{ serverId: string }>> {
  const serverIds = new Set<string>()
  let afterToolId: string | undefined

  while (true) {
    const page = await listWorkflowMcpToolSyncPage(tx, workflowId, afterToolId)
    if (page.length === 0) break

    const pageTools = page.slice(0, MCP_SYNC_TOOLS_PAGE_SIZE)
    for (const tool of pageTools) {
      serverIds.add(tool.serverId)
      if (serverIds.size > MAX_MCP_SERVERS_PER_WORKFLOW) {
        throw new WorkflowMcpServerFanoutError(workflowId)
      }
    }

    if (page.length <= MCP_SYNC_TOOLS_PAGE_SIZE) break
    afterToolId = pageTools.at(-1)?.id
  }

  return [...serverIds].sort().map((serverId) => ({ serverId }))
}

/**
 * Generate MCP tool parameter schema from workflow blocks.
 */
export function generateSchemaFromBlocks(blocks: Record<string, unknown>): Record<string, unknown> {
  const inputFormat = extractInputFormatFromBlocks(blocks)
  if (!inputFormat || inputFormat.length === 0) {
    return EMPTY_SCHEMA
  }
  return { ...generateToolInputSchema(inputFormat) }
}

/**
 * Load a workflow's active deployed state and generate its MCP parameter schema.
 * Workflows with no inputs or no active deployment use an empty object schema.
 */
export async function generateParameterSchemaForWorkflow(
  workflowId: string
): Promise<Record<string, unknown>> {
  const deployed = await loadDeployedWorkflowState(workflowId)
  if (!deployed?.blocks) return EMPTY_SCHEMA
  return generateSchemaFromBlocks(deployed.blocks as Record<string, unknown>)
}

interface SyncOptions {
  workflowId: string
  requestId: string
  /** If provided, use this state instead of loading from DB */
  state?: { blocks?: Record<string, unknown> }
  /** Context for logging (e.g., 'deploy', 'revert', 'activate') */
  context?: string
  tx?: DbOrTx
  notify?: boolean
  throwOnError?: boolean
}

/**
 * Sync MCP tools for a workflow with the latest parameter schema.
 * - If the workflow has no start block, removes all MCP tools
 * - Otherwise, updates all MCP tools with the current schema
 *
 * @param options.workflowId - The workflow ID to sync
 * @param options.requestId - Request ID for logging
 * @param options.state - Optional workflow state (if not provided, loads from DB)
 * @param options.context - Optional context for log messages
 */
export async function syncMcpToolsForWorkflow(
  options: SyncOptions
): Promise<Array<{ serverId: string }>> {
  if (!options.tx) {
    const tools = await db.transaction((tx) =>
      syncMcpToolsForWorkflow({ ...options, tx, notify: false })
    )
    if (options.notify ?? true) notifyMcpToolServers(tools)
    return tools
  }

  const {
    workflowId,
    requestId,
    state,
    context = 'sync',
    tx,
    notify = true,
    throwOnError = false,
  } = options

  try {
    let workflowState: { blocks?: Record<string, unknown> } | null = state ?? null
    if (!workflowState) {
      workflowState = await loadDeployedWorkflowState(workflowId)
    }

    if (!hasValidStartBlockInState(workflowState as WorkflowState | null)) {
      const affectedTools = await removeMcpToolsForWorkflow(workflowId, requestId, tx, false, true)
      if (notify) notifyMcpToolServers(affectedTools)
      return affectedTools
    }

    const generatedParameterSchema = workflowState?.blocks
      ? generateSchemaFromBlocks(workflowState.blocks)
      : EMPTY_SCHEMA
    const schemaLimitError = validateMcpToolMetadataForStorage({
      parameterSchema: generatedParameterSchema,
    })
    if (schemaLimitError) {
      throw new Error(schemaLimitError)
    }
    const parameterSchema = generatedParameterSchema

    const affectedServerIds = new Set<string>()
    const lockedServers = await collectWorkflowMcpToolServerIds(tx, workflowId)
    if (lockedServers.length === 0) return []

    for (const { serverId } of lockedServers) {
      await acquireWorkflowMcpServerLock(tx, serverId)
      affectedServerIds.add(serverId)
    }
    const lockedServerIds = [...affectedServerIds]

    const usageStateByServer = new Map<string, ServerMetadataUsageState>()
    for (const { serverId } of lockedServers) {
      const rows = await getMcpServerToolMetadataUsageRows(tx, serverId)
      usageStateByServer.set(serverId, {
        usageByToolId: new Map(rows.map((row) => [row.id, row])),
        serverUsage: getMcpToolMetadataUsageFromRows(rows),
      })
    }

    let syncedToolCount = 0
    let afterToolId: string | undefined

    while (true) {
      const page = await listWorkflowMcpToolSyncPage(tx, workflowId, afterToolId, lockedServerIds)
      if (page.length === 0) break

      const pageTools = page.slice(0, MCP_SYNC_TOOLS_PAGE_SIZE)
      const toolsByServer = new Map<string, WorkflowMcpToolSyncRow[]>()
      for (const tool of pageTools) {
        affectedServerIds.add(tool.serverId)
        const serverTools = toolsByServer.get(tool.serverId) ?? []
        serverTools.push(tool)
        toolsByServer.set(tool.serverId, serverTools)
      }

      for (const [serverId, serverTools] of [...toolsByServer].sort(([left], [right]) =>
        left.localeCompare(right)
      )) {
        const usageState = usageStateByServer.get(serverId)
        if (!usageState) {
          throw new Error(`Missing locked MCP server usage state for server ${serverId}`)
        }
        const schemaToolIds: string[] = []
        const emptySchemaToolIds: string[] = []

        for (const tool of serverTools) {
          const existingUsage = subtractMcpToolMetadataUsageRow(
            usageState.serverUsage,
            usageState.usageByToolId.get(tool.id)
          )
          const shouldUseEmptySchema = exceedsMcpServerToolMetadataBudget(existingUsage, {
            toolName: tool.toolName,
            toolDescription: tool.toolDescription,
            parameterSchema,
          })
          const schemaForTool = shouldUseEmptySchema ? EMPTY_SCHEMA : parameterSchema

          if (shouldUseEmptySchema) {
            emptySchemaToolIds.push(tool.id)
          } else {
            schemaToolIds.push(tool.id)
          }

          const updatedUsageRow = createMcpToolMetadataUsageRow({
            id: tool.id,
            toolName: tool.toolName,
            toolDescription: tool.toolDescription,
            parameterSchema: schemaForTool,
          })
          usageState.usageByToolId.set(tool.id, updatedUsageRow)
          usageState.serverUsage = addMcpToolMetadataUsageRow(existingUsage, updatedUsageRow)
        }

        if (schemaToolIds.length > 0) {
          await tx
            .update(workflowMcpTool)
            .set({
              parameterSchema,
              updatedAt: new Date(),
            })
            .where(inArray(workflowMcpTool.id, schemaToolIds))
        }

        if (emptySchemaToolIds.length > 0) {
          await tx
            .update(workflowMcpTool)
            .set({
              parameterSchema: EMPTY_SCHEMA,
              updatedAt: new Date(),
            })
            .where(inArray(workflowMcpTool.id, emptySchemaToolIds))
        }
      }

      syncedToolCount += pageTools.length
      if (page.length <= MCP_SYNC_TOOLS_PAGE_SIZE) break
      afterToolId = pageTools.at(-1)?.id
    }

    logger.info(
      `[${requestId}] Synced ${syncedToolCount} MCP tool(s) for workflow (${context}): ${workflowId}`
    )

    const affectedTools = [...affectedServerIds].map((serverId) => ({ serverId }))
    if (notify) notifyMcpToolServers(affectedTools)
    return affectedTools
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools (${context}):`, error)
    if (throwOnError) throw error
    return []
  }
}

/**
 * Remove all MCP tools for a workflow (used when undeploying).
 * Queries affected tools before deleting so we can notify their servers.
 */
export async function removeMcpToolsForWorkflow(
  workflowId: string,
  requestId: string,
  tx?: DbOrTx,
  notify = true,
  throwOnError = false
): Promise<Array<{ serverId: string }>> {
  if (!tx) {
    const tools = await db.transaction((transaction) =>
      removeMcpToolsForWorkflow(workflowId, requestId, transaction, false, throwOnError)
    )
    if (notify) notifyMcpToolServers(tools)
    return tools
  }

  try {
    const tools = await collectWorkflowMcpToolServerIds(tx, workflowId)

    if (tools.length === 0) return []

    for (const { serverId } of tools) {
      await acquireWorkflowMcpServerLock(tx, serverId)
    }

    await tx.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))
    logger.info(`[${requestId}] Removed MCP tools for workflow: ${workflowId}`)

    if (notify) notifyMcpToolServers(tools)
    return tools
  } catch (error) {
    logger.error(`[${requestId}] Error removing MCP tools:`, error)
    if (throwOnError) throw error
    return []
  }
}

/**
 * Publish pubsub events for each unique server affected by a tool change.
 * Resolves workspace IDs from the server table so callers don't need to pass them.
 */
export function notifyMcpToolServers(tools: Array<{ serverId: string }>): void {
  if (!mcpPubSub) return

  const uniqueServerIds = [...new Set(tools.map((t) => t.serverId))]

  void (async () => {
    try {
      const servers = await db
        .select({ id: workflowMcpServer.id, workspaceId: workflowMcpServer.workspaceId })
        .from(workflowMcpServer)
        .where(
          and(inArray(workflowMcpServer.id, uniqueServerIds), isNull(workflowMcpServer.deletedAt))
        )

      for (const server of servers) {
        mcpPubSub.publishWorkflowToolsChanged({
          serverId: server.id,
          workspaceId: server.workspaceId,
        })
      }
    } catch (error) {
      logger.error('Error notifying affected servers:', error)
    }
  })()
}
