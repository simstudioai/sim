import { db, workflow, workflowDeploymentVersion, workflowMcpTool } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractInputFormatFromBlocks,
  generateToolInputSchema,
} from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowActivateDeploymentAPI')

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
 * Sync MCP tools when activating a deployment version.
 * If the version has no start block, remove all MCP tools.
 */
async function syncMcpToolsOnVersionActivate(
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

    // Check if the activated version has a valid start block
    if (!hasValidStartBlockInState(versionState)) {
      // No start block - remove all MCP tools for this workflow
      await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))

      logger.info(
        `[${requestId}] Removed ${tools.length} MCP tool(s) - activated version has no start block: ${workflowId}`
      )
      return
    }

    // Generate the parameter schema from the activated version's state
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
      `[${requestId}] Synced ${tools.length} MCP tool(s) for workflow version activation: ${workflowId}`
    )
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools on version activate:`, error)
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

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version', 400)
    }

    const now = new Date()

    // Get the state of the version being activated for MCP tool sync
    const [versionData] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .limit(1)

    await db.transaction(async (tx) => {
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )

      const updated = await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: true })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.version, versionNum)
          )
        )
        .returning({ id: workflowDeploymentVersion.id })

      if (updated.length === 0) {
        throw new Error('Deployment version not found')
      }

      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt: now,
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, id))
    })

    // Sync MCP tools with the activated version's parameter schema
    if (versionData?.state) {
      await syncMcpToolsOnVersionActivate(id, versionData.state, requestId)
    }

    return createSuccessResponse({ success: true, deployedAt: now })
  } catch (error: any) {
    logger.error(`[${requestId}] Error activating deployment for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to activate deployment', 500)
  }
}
