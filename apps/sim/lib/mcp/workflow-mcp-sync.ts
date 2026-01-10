import { db, workflowMcpTool } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { extractInputFormatFromBlocks, generateToolInputSchema } from './workflow-tool-schema'

const logger = createLogger('WorkflowMcpSync')

/**
 * Generate MCP tool parameter schema from workflow blocks
 */
function generateSchemaFromBlocks(blocks: Record<string, unknown>): Record<string, unknown> {
  const inputFormat = extractInputFormatFromBlocks(blocks)
  if (!inputFormat || inputFormat.length === 0) {
    return { type: 'object', properties: {} }
  }
  return generateToolInputSchema(inputFormat) as unknown as Record<string, unknown>
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
    // Get all MCP tools that use this workflow
    const tools = await db
      .select({ id: workflowMcpTool.id })
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.workflowId, workflowId))

    if (tools.length === 0) {
      logger.debug(`[${requestId}] No MCP tools to sync for workflow: ${workflowId}`)
      return
    }

    // Get workflow state (from param or load from DB)
    let workflowState: { blocks?: Record<string, unknown> } | null = state ?? null
    if (!workflowState) {
      workflowState = await loadWorkflowFromNormalizedTables(workflowId)
    }

    // Check if workflow has a valid start block
    if (!hasValidStartBlockInState(workflowState as WorkflowState | null)) {
      await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))
      logger.info(
        `[${requestId}] Removed ${tools.length} MCP tool(s) - workflow has no start block (${context}): ${workflowId}`
      )
      return
    }

    // Generate and update parameter schema
    const parameterSchema = workflowState?.blocks
      ? generateSchemaFromBlocks(workflowState.blocks)
      : { type: 'object', properties: {} }

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
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools (${context}):`, error)
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Remove all MCP tools for a workflow (used when undeploying)
 */
export async function removeMcpToolsForWorkflow(
  workflowId: string,
  requestId: string
): Promise<void> {
  try {
    await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))
    logger.info(`[${requestId}] Removed MCP tools for workflow: ${workflowId}`)
  } catch (error) {
    logger.error(`[${requestId}] Error removing MCP tools:`, error)
    // Don't throw - this is a non-critical operation
  }
}
