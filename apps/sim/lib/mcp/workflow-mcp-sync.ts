import { db, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_MCP_SERVERS_PER_WORKFLOW, MAX_MCP_TOOLS_PER_SERVER } from '@/lib/mcp/constants'
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

interface RestoreCandidate {
  id: string
  serverId: string
  toolName: string
  toolDescription: string | null
  parameterSchema: unknown
}

/**
 * Re-run, against a candidate's already-locked server, the invariants
 * `performCreateWorkflowMcpTool` enforces when a registration is first created,
 * plus the `(server_id, workflow_id)` uniqueness that
 * `workflow_mcp_tool_server_workflow_unique` enforces over unarchived rows.
 * Every one of them is read under the server's lock, so a concurrent manual
 * tool create cannot slip a live row in between the check and the unarchive.
 * Returns the reason the candidate must stay archived, or `null` when it is
 * safe to revive.
 */
async function getRestoreSkipReason(
  tx: DbOrTx,
  workflowId: string,
  candidate: RestoreCandidate
): Promise<string | null> {
  const liveTools = await tx
    .select({
      id: workflowMcpTool.id,
      toolName: workflowMcpTool.toolName,
      workflowId: workflowMcpTool.workflowId,
    })
    .from(workflowMcpTool)
    .where(
      and(eq(workflowMcpTool.serverId, candidate.serverId), isNull(workflowMcpTool.archivedAt))
    )
    .limit(MAX_MCP_TOOLS_PER_SERVER)

  if (liveTools.some((tool) => tool.workflowId === workflowId)) {
    return 'the server already carries a live registration for this workflow'
  }

  if (liveTools.length >= MAX_MCP_TOOLS_PER_SERVER) {
    return `server already has the maximum of ${MAX_MCP_TOOLS_PER_SERVER} tools`
  }

  if (liveTools.some((tool) => tool.toolName === candidate.toolName)) {
    return `another live tool on this server already uses the name "${candidate.toolName}"`
  }

  const usage = getMcpToolMetadataUsageFromRows(
    await getMcpServerToolMetadataUsageRows(tx, candidate.serverId)
  )
  if (
    exceedsMcpServerToolMetadataBudget(usage, {
      toolName: candidate.toolName,
      toolDescription: candidate.toolDescription,
      parameterSchema: candidate.parameterSchema,
    })
  ) {
    return 'restoring it would exceed the server tools/list metadata budget'
  }

  return null
}

/**
 * Un-archive the registrations an earlier undeploy withdrew, so redeploying a
 * workflow republishes it on exactly the servers it was published on before.
 *
 * Repeated undeploy/skipped-restore/manual-re-add cycles leave several archived
 * generations per server, so the candidate query dedupes in SQL — one row per
 * `server_id`, the most recently updated generation winning — and only then
 * bounds the result at `MAX_MCP_SERVERS_PER_WORKFLOW`. Bounding rows instead
 * would let one server's stale generations consume the budget and silently drop
 * other servers out of the restore entirely.
 *
 * A candidate is dropped when reviving it would break an invariant that
 * `performCreateWorkflowMcpTool` enforces on create but that archiving silently
 * relaxes: archiving frees both the tool name and the server slot, so while a
 * workflow sits undeployed another workflow can take its name on the server or
 * fill the server to `MAX_MCP_TOOLS_PER_SERVER`, and no database constraint
 * covers either case. It is dropped too when the server already carries a live
 * registration for this workflow, which `workflow_mcp_tool_server_workflow_unique`
 * does cover — a violation there would abort the whole deploy transaction.
 * {@link getRestoreSkipReason} checks all four. A dropped candidate stays
 * archived and is logged as a warning naming the workflow, the server, and the
 * reason: restore runs inside the deploy transaction, so throwing would fail an
 * otherwise valid deploy over a registration the user can restore by hand, while
 * silently skipping would leave the operator with no signal at all.
 *
 * Locks are taken in sorted server order before any of those checks read the
 * server's live rows, matching every other writer here, so concurrent syncs
 * neither deadlock against each other nor race the checks.
 */
async function restoreArchivedMcpToolsForWorkflow(
  tx: DbOrTx,
  workflowId: string,
  requestId: string
): Promise<void> {
  const archived: RestoreCandidate[] = await tx
    .selectDistinctOn([workflowMcpTool.serverId], {
      id: workflowMcpTool.id,
      serverId: workflowMcpTool.serverId,
      toolName: workflowMcpTool.toolName,
      toolDescription: workflowMcpTool.toolDescription,
      parameterSchema: workflowMcpTool.parameterSchema,
    })
    .from(workflowMcpTool)
    .where(and(eq(workflowMcpTool.workflowId, workflowId), isNotNull(workflowMcpTool.archivedAt)))
    .orderBy(
      asc(workflowMcpTool.serverId),
      desc(workflowMcpTool.updatedAt),
      desc(workflowMcpTool.id)
    )
    .limit(MAX_MCP_SERVERS_PER_WORKFLOW)

  if (archived.length === 0) return

  const candidateByServer = new Map<string, RestoreCandidate>(
    archived.map((row) => [row.serverId, row])
  )
  const candidateServerIds = [...candidateByServer.keys()].sort()
  for (const serverId of candidateServerIds) {
    await acquireWorkflowMcpServerLock(tx, serverId)
  }

  const restorableIds: string[] = []
  for (const serverId of candidateServerIds) {
    const candidate = candidateByServer.get(serverId)
    if (!candidate) continue

    const skipReason = await getRestoreSkipReason(tx, workflowId, candidate)
    if (skipReason) {
      logger.warn(
        `[${requestId}] Skipped restoring archived MCP tool "${candidate.toolName}" for workflow ${workflowId} on server ${serverId}: ${skipReason}`
      )
      continue
    }
    restorableIds.push(candidate.id)
  }
  if (restorableIds.length === 0) return

  await tx
    .update(workflowMcpTool)
    .set({ archivedAt: null })
    .where(inArray(workflowMcpTool.id, restorableIds))

  logger.info(
    `[${requestId}] Restored ${restorableIds.length} archived MCP tool(s) for workflow: ${workflowId}`
  )
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
 * format fields. Shared so callers (e.g. the copilot `deploy_as_mcp` tool) can
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

    await restoreArchivedMcpToolsForWorkflow(tx, workflowId, requestId)

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
 * Withdraw every MCP tool registration for a workflow (used when undeploying).
 * Queries affected tools before withdrawing so their servers can be notified.
 *
 * Rows are archived, not deleted. Deploy/undeploy is a reversible lifecycle:
 * an undeploy that destroyed the registrations would force the user to re-create
 * by hand every server entry that published the workflow, with no warning and no
 * way back. {@link restoreArchivedMcpToolsForWorkflow} brings them back on the
 * next deploy. Deleting a tool through the MCP server surface stays a hard
 * delete, so a registration the user removed on purpose is never resurrected.
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

    await tx
      .update(workflowMcpTool)
      .set({ archivedAt: new Date() })
      .where(and(eq(workflowMcpTool.workflowId, workflowId), isNull(workflowMcpTool.archivedAt)))
    logger.info(`[${requestId}] Archived MCP tools for workflow: ${workflowId}`)

    return tools
  } catch (error) {
    logger.error(`[${requestId}] Error archiving MCP tools:`, error)
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
