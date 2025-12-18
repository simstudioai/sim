import { db, workflow, workflowDeploymentVersion, workflowMcpTool } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractInputFormatFromBlocks,
  generateToolInputSchema,
} from '@/lib/mcp/workflow-tool-schema'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('RevertToDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Extract input format from a deployment version state and generate MCP tool parameter schema
 */
function generateMcpToolSchemaFromState(state: any): Record<string, unknown> {
  try {
    if (!state?.blocks) {
      return { type: 'object', properties: {} }
    }

    const inputFormat = extractInputFormatFromBlocks(state.blocks)
    if (!inputFormat || inputFormat.length === 0) {
      return { type: 'object', properties: {} }
    }

    return generateToolInputSchema(inputFormat) as unknown as Record<string, unknown>
  } catch (error) {
    logger.warn('Error generating MCP tool schema from state:', error)
    return { type: 'object', properties: {} }
  }
}

/**
 * Sync MCP tools when reverting to a deployment version.
 * If the version has no start block, remove all MCP tools.
 */
async function syncMcpToolsOnRevert(
  workflowId: string,
  versionState: any,
  requestId: string
): Promise<void> {
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

    // Check if the reverted version has a valid start block
    if (!hasValidStartBlockInState(versionState)) {
      // No start block - remove all MCP tools for this workflow
      await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))

      logger.info(
        `[${requestId}] Removed ${tools.length} MCP tool(s) - reverted version has no start block: ${workflowId}`
      )
      return
    }

    // Generate the parameter schema from the reverted version's state
    const parameterSchema = generateMcpToolSchemaFromState(versionState)

    // Update all tools with the new schema
    await db
      .update(workflowMcpTool)
      .set({
        parameterSchema,
        updatedAt: new Date(),
      })
      .where(eq(workflowMcpTool.workflowId, workflowId))

    logger.info(
      `[${requestId}] Synced ${tools.length} MCP tool(s) for workflow revert: ${workflowId}`
    )
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools on revert:`, error)
    // Don't throw - this is a non-critical operation
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionSelector = version === 'active' ? null : Number(version)
    if (version !== 'active' && !Number.isFinite(versionSelector)) {
      return createErrorResponse('Invalid version', 400)
    }

    let stateRow: { state: any } | null = null
    if (version === 'active') {
      const [row] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .limit(1)
      stateRow = row || null
    } else {
      const [row] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.version, versionSelector as number)
          )
        )
        .limit(1)
      stateRow = row || null
    }

    if (!stateRow?.state) {
      return createErrorResponse('Deployment version not found', 404)
    }

    const deployedState = stateRow.state
    if (!deployedState.blocks || !deployedState.edges) {
      return createErrorResponse('Invalid deployed state structure', 500)
    }

    const saveResult = await saveWorkflowToNormalizedTables(id, {
      blocks: deployedState.blocks,
      edges: deployedState.edges,
      loops: deployedState.loops || {},
      parallels: deployedState.parallels || {},
      lastSaved: Date.now(),
      isDeployed: true,
      deployedAt: new Date(),
      deploymentStatuses: deployedState.deploymentStatuses || {},
    })

    if (!saveResult.success) {
      return createErrorResponse(saveResult.error || 'Failed to save deployed state', 500)
    }

    await db
      .update(workflow)
      .set({ lastSynced: new Date(), updatedAt: new Date() })
      .where(eq(workflow.id, id))

    // Sync MCP tools with the reverted version's parameter schema
    await syncMcpToolsOnRevert(id, deployedState, requestId)

    try {
      const socketServerUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
      await fetch(`${socketServerUrl}/api/workflow-reverted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: id, timestamp: Date.now() }),
      })
    } catch (e) {
      logger.error('Error sending workflow reverted event to socket server', e)
    }

    return createSuccessResponse({
      message: 'Reverted to deployment version',
      lastSaved: Date.now(),
    })
  } catch (error: any) {
    logger.error('Error reverting to deployment version', error)
    return createErrorResponse(error.message || 'Failed to revert', 500)
  }
}
