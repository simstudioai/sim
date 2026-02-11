import { db, workflowMcpServer, workflowMcpTool } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq, inArray } from 'drizzle-orm'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { mcpPubSub } from './pubsub'
import { extractInputFormatFromBlocks, generateToolInputSchema } from './workflow-tool-schema'

const logger = createLogger('WorkflowMcpSync')

const EMPTY_SCHEMA: Record<string, unknown> = Object.freeze({ type: 'object', properties: {} })

/**
 * Generate MCP tool parameter schema from workflow blocks.
 */
export function generateSchemaFromBlocks(blocks: Record<string, unknown>): Record<string, unknown> {
  const inputFormat = extractInputFormatFromBlocks(blocks)
  if (!inputFormat || inputFormat.length === 0) {
    return EMPTY_SCHEMA
  }
  return generateToolInputSchema(inputFormat) as unknown as Record<string, unknown>
}

/**
 * Load a workflow's active deployed state and generate its MCP parameter schema.
 * Returns a proper JSON Schema derived from the start block's input format,
 * or a fallback empty schema if the workflow has no inputs or no active deployment.
 */
export async function generateParameterSchemaForWorkflow(
  workflowId: string
): Promise<Record<string, unknown>> {
  try {
    const deployed = await loadDeployedWorkflowState(workflowId)
    if (!deployed?.blocks) return EMPTY_SCHEMA
    return generateSchemaFromBlocks(deployed.blocks as Record<string, unknown>)
  } catch {
    return EMPTY_SCHEMA
  }
}

interface SyncOptions {
  workflowId: string
  requestId: string
  /** If provided, use this state instead of loading from DB */
  state?: { blocks?: Record<string, unknown> }
  /** Context for logging (e.g., 'deploy', 'revert', 'activate') */
  context?: string
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
export async function syncMcpToolsForWorkflow(options: SyncOptions): Promise<void> {
  const { workflowId, requestId, state, context = 'sync' } = options

  try {
    const tools = await db
      .select({ id: workflowMcpTool.id, serverId: workflowMcpTool.serverId })
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.workflowId, workflowId))

    if (tools.length === 0) {
      logger.debug(`[${requestId}] No MCP tools to sync for workflow: ${workflowId}`)
      return
    }

    let workflowState: { blocks?: Record<string, unknown> } | null = state ?? null
    if (!workflowState) {
      workflowState = await loadDeployedWorkflowState(workflowId)
    }

    if (!hasValidStartBlockInState(workflowState as WorkflowState | null)) {
      await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))
      logger.info(
        `[${requestId}] Removed ${tools.length} MCP tool(s) - workflow has no start block (${context}): ${workflowId}`
      )
      notifyAffectedServers(tools)
      return
    }

    const parameterSchema = workflowState?.blocks
      ? generateSchemaFromBlocks(workflowState.blocks)
      : EMPTY_SCHEMA

    await db
      .update(workflowMcpTool)
      .set({
        parameterSchema,
        updatedAt: new Date(),
      })
      .where(eq(workflowMcpTool.workflowId, workflowId))

    logger.info(
      `[${requestId}] Synced ${tools.length} MCP tool(s) for workflow (${context}): ${workflowId}`
    )

    notifyAffectedServers(tools)
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools (${context}):`, error)
  }
}

/**
 * Remove all MCP tools for a workflow (used when undeploying).
 * Queries affected tools before deleting so we can notify their servers.
 */
export async function removeMcpToolsForWorkflow(
  workflowId: string,
  requestId: string
): Promise<void> {
  try {
    const tools = await db
      .select({ id: workflowMcpTool.id, serverId: workflowMcpTool.serverId })
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.workflowId, workflowId))

    if (tools.length === 0) return

    await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))
    logger.info(`[${requestId}] Removed MCP tools for workflow: ${workflowId}`)

    notifyAffectedServers(tools)
  } catch (error) {
    logger.error(`[${requestId}] Error removing MCP tools:`, error)
  }
}

/**
 * Publish pubsub events for each unique server affected by a tool change.
 * Resolves workspace IDs from the server table so callers don't need to pass them.
 */
function notifyAffectedServers(tools: Array<{ serverId: string }>): void {
  if (!mcpPubSub) return

  const uniqueServerIds = [...new Set(tools.map((t) => t.serverId))]

  void (async () => {
    try {
      const servers = await db
        .select({ id: workflowMcpServer.id, workspaceId: workflowMcpServer.workspaceId })
        .from(workflowMcpServer)
        .where(inArray(workflowMcpServer.id, uniqueServerIds))

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
