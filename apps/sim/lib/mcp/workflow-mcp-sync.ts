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
import type { InputFormatField } from '@/lib/workflows/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { mcpPubSub } from './pubsub'
import {
  applyDescriptionOverrides,
  extractInputFormatFromBlocks,
  generateToolInputSchema,
  pruneOverridesToSchema,
} from './workflow-tool-schema'

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
  parameterDescriptionOverrides: Record<string, string>
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
      parameterDescriptionOverrides: workflowMcpTool.parameterDescriptionOverrides,
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

/**
 * Load a workflow's active deployed state and return its start-trigger input
 * format fields. Shared so callers (e.g. the copilot `deploy_mcp` tool) can
 * build a parameter schema from the same input source the deploy modal uses.
 */
export async function getDeployedWorkflowInputFormat(
  workflowId: string
): Promise<InputFormatField[]> {
  const deployed = await loadDeployedWorkflowState(workflowId)
  if (!deployed?.blocks) return []
  return extractInputFormatFromBlocks(deployed.blocks as Record<string, unknown>) ?? []
}

interface SyncOptionsBase {
  workflowId: string
  requestId: string
  /** Context for logging (e.g., 'deploy', 'revert', 'activate') */
  context?: string
  throwOnError?: boolean
}

/**
 * Callers running inside a transaction must preload the workflow state:
 * loading it lazily would issue queries on the global pool while the
 * transaction already holds a pooled connection.
 *
 * Server notification is strictly post-commit. The standalone arm notifies
 * after its own transaction commits (`notify` defaults to true); the `tx` arm
 * never notifies — publishing before the caller's transaction commits would
 * announce state that may still roll back, so the transaction owner notifies
 * after commit (see deployment-outbox).
 */
type SyncOptions = SyncOptionsBase &
  (
    | { tx: DbOrTx; state: { blocks?: Record<string, unknown> }; notify?: false }
    | { tx?: undefined; state?: { blocks?: Record<string, unknown> }; notify?: boolean }
  )

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
    let state = options.state
    if (!state) {
      try {
        state = await loadDeployedWorkflowState(options.workflowId)
      } catch (error) {
        logger.error(
          `[${options.requestId}] Error loading deployed state for MCP tool sync (${options.context ?? 'sync'}):`,
          error
        )
        if (options.throwOnError) throw error
        return []
      }
    }
    const resolvedState = state
    const tools = await db.transaction((tx) =>
      syncMcpToolsForWorkflow({ ...options, state: resolvedState, tx, notify: false })
    )
    if (options.notify ?? true) notifyMcpToolServers(tools)
    return tools
  }

  const { workflowId, requestId, state, context = 'sync', tx, throwOnError = false } = options

  try {
    if (!hasValidStartBlockInState(state as WorkflowState | null)) {
      return await removeMcpToolsForWorkflow(workflowId, requestId, tx, true)
    }

    const generatedParameterSchema = state.blocks
      ? generateSchemaFromBlocks(state.blocks)
      : EMPTY_SCHEMA
    const schemaLimitError = validateMcpToolMetadataForStorage({
      parameterSchema: generatedParameterSchema,
    })
    if (schemaLimitError) {
      throw new Error(schemaLimitError)
    }
    const baseParameterSchema = generatedParameterSchema

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
        for (const tool of serverTools) {
          const existingUsage = subtractMcpToolMetadataUsageRow(
            usageState.serverUsage,
            usageState.usageByToolId.get(tool.id)
          )
          const prunedOverrides = pruneOverridesToSchema(
            tool.parameterDescriptionOverrides,
            baseParameterSchema
          )
          const mergedSchema = applyDescriptionOverrides(baseParameterSchema, prunedOverrides)
          const shouldUseEmptySchema = exceedsMcpServerToolMetadataBudget(existingUsage, {
            toolName: tool.toolName,
            toolDescription: tool.toolDescription,
            parameterSchema: mergedSchema,
          })
          const schemaForTool = shouldUseEmptySchema ? EMPTY_SCHEMA : mergedSchema

          const updatedUsageRow = createMcpToolMetadataUsageRow({
            id: tool.id,
            toolName: tool.toolName,
            toolDescription: tool.toolDescription,
            parameterSchema: schemaForTool,
          })
          usageState.usageByToolId.set(tool.id, updatedUsageRow)
          usageState.serverUsage = addMcpToolMetadataUsageRow(existingUsage, updatedUsageRow)

          await tx
            .update(workflowMcpTool)
            .set({
              parameterSchema: schemaForTool,
              parameterDescriptionOverrides: prunedOverrides,
              updatedAt: new Date(),
            })
            .where(eq(workflowMcpTool.id, tool.id))
        }
      }

      syncedToolCount += pageTools.length
      if (page.length <= MCP_SYNC_TOOLS_PAGE_SIZE) break
      afterToolId = pageTools.at(-1)?.id
    }

    logger.info(
      `[${requestId}] Synced ${syncedToolCount} MCP tool(s) for workflow (${context}): ${workflowId}`
    )

    return [...affectedServerIds].map((serverId) => ({ serverId }))
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools (${context}):`, error)
    if (throwOnError) throw error
    return []
  }
}

/**
 * Remove all MCP tools for a workflow (used when undeploying).
 * Queries affected tools before deleting so their servers can be notified.
 *
 * Server notification is strictly post-commit: the standalone path notifies
 * after the transaction opened here commits; when `tx` is provided the
 * transaction owner notifies after commit using the returned server ids.
 */
export async function removeMcpToolsForWorkflow(
  workflowId: string,
  requestId: string,
  tx?: DbOrTx,
  throwOnError = false
): Promise<Array<{ serverId: string }>> {
  if (!tx) {
    const tools = await db.transaction((transaction) =>
      removeMcpToolsForWorkflow(workflowId, requestId, transaction, throwOnError)
    )
    notifyMcpToolServers(tools)
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
