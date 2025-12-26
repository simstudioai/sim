import { db, workflow, workflowDeploymentVersion, workflowMcpTool } from '@sim/db'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractInputFormatFromBlocks,
  generateToolInputSchema,
} from '@/lib/mcp/workflow-tool-schema'
import { deployWorkflow, loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  createSchedulesForDeploy,
  deleteSchedulesForWorkflow,
  validateWorkflowSchedules,
} from '@/lib/workflows/schedules'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

/**
 * Check if a workflow has a valid start block by loading from database
 */
async function hasValidStartBlock(workflowId: string): Promise<boolean> {
  try {
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    return hasValidStartBlockInState(normalizedData)
  } catch (error) {
    logger.warn('Error checking for start block:', error)
    return false
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Extract input format from workflow blocks and generate MCP tool parameter schema
 */
async function generateMcpToolSchema(workflowId: string): Promise<Record<string, unknown>> {
  try {
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalizedData?.blocks) {
      return { type: 'object', properties: {} }
    }

    const inputFormat = extractInputFormatFromBlocks(normalizedData.blocks)
    if (!inputFormat || inputFormat.length === 0) {
      return { type: 'object', properties: {} }
    }

    return generateToolInputSchema(inputFormat) as unknown as Record<string, unknown>
  } catch (error) {
    logger.warn('Error generating MCP tool schema:', error)
    return { type: 'object', properties: {} }
  }
}

/**
 * Update all MCP tools that reference this workflow with the latest parameter schema.
 * If the workflow no longer has a start block, remove all MCP tools.
 */
async function syncMcpToolsOnDeploy(workflowId: string, requestId: string): Promise<void> {
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

    // Check if workflow still has a valid start block
    const hasStart = await hasValidStartBlock(workflowId)
    if (!hasStart) {
      // No start block - remove all MCP tools for this workflow
      await db.delete(workflowMcpTool).where(eq(workflowMcpTool.workflowId, workflowId))

      logger.info(
        `[${requestId}] Removed ${tools.length} MCP tool(s) - workflow no longer has a start block: ${workflowId}`
      )
      return
    }

    // Generate the latest parameter schema
    const parameterSchema = await generateMcpToolSchema(workflowId)

    // Update all tools with the new schema
    await db
      .update(workflowMcpTool)
      .set({
        parameterSchema,
        updatedAt: new Date(),
      })
      .where(eq(workflowMcpTool.workflowId, workflowId))

    logger.info(`[${requestId}] Synced ${tools.length} MCP tool(s) for workflow: ${workflowId}`)
  } catch (error) {
    logger.error(`[${requestId}] Error syncing MCP tools:`, error)
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Remove all MCP tools that reference this workflow when undeploying
 */
async function removeMcpToolsOnUndeploy(workflowId: string, requestId: string): Promise<void> {
  try {
    const result = await db
      .delete(workflowMcpTool)
      .where(eq(workflowMcpTool.workflowId, workflowId))

    logger.info(`[${requestId}] Removed MCP tools for undeployed workflow: ${workflowId}`)
  } catch (error) {
    logger.error(`[${requestId}] Error removing MCP tools:`, error)
    // Don't throw - this is a non-critical operation
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployment info for workflow: ${id}`)

    const { error, workflow: workflowData } = await validateWorkflowPermissions(
      id,
      requestId,
      'read'
    )
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    if (!workflowData.isDeployed) {
      logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
      return createSuccessResponse({
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
        needsRedeployment: false,
      })
    }

    let needsRedeployment = false
    const [active] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (active?.state) {
      const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/persistence/utils')
      const normalizedData = await loadWorkflowFromNormalizedTables(id)
      if (normalizedData) {
        const [workflowRecord] = await db
          .select({ variables: workflow.variables })
          .from(workflow)
          .where(eq(workflow.id, id))
          .limit(1)

        const currentState = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          variables: workflowRecord?.variables || {},
        }
        const { hasWorkflowChanged } = await import('@/lib/workflows/comparison')
        needsRedeployment = hasWorkflowChanged(currentState as any, active.state as any)
      }
    }

    logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

    const responseApiKeyInfo = workflowData.workspaceId ? 'Workspace API keys' : 'Personal API keys'

    return createSuccessResponse({
      apiKey: responseApiKeyInfo,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
      needsRedeployment,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployment info: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to fetch deployment information', 500)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Deploying workflow: ${id}`)

    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const actorUserId: string | null = session?.user?.id ?? null
    if (!actorUserId) {
      logger.warn(`[${requestId}] Unable to resolve actor user for workflow deployment: ${id}`)
      return createErrorResponse('Unable to determine deploying user', 400)
    }

    const normalizedData = await loadWorkflowFromNormalizedTables(id)
    if (!normalizedData) {
      return createErrorResponse('Failed to load workflow state', 500)
    }

    const scheduleValidation = validateWorkflowSchedules(normalizedData.blocks)
    if (!scheduleValidation.isValid) {
      logger.warn(
        `[${requestId}] Schedule validation failed for workflow ${id}: ${scheduleValidation.error}`
      )
      return createErrorResponse(`Invalid schedule configuration: ${scheduleValidation.error}`, 400)
    }

    const deployResult = await deployWorkflow({
      workflowId: id,
      deployedBy: actorUserId,
      workflowName: workflowData!.name,
    })

    if (!deployResult.success) {
      return createErrorResponse(deployResult.error || 'Failed to deploy workflow', 500)
    }

    const deployedAt = deployResult.deployedAt!

    let scheduleInfo: { scheduleId?: string; cronExpression?: string; nextRunAt?: Date } = {}
    const scheduleResult = await createSchedulesForDeploy(id, normalizedData.blocks, db)
    if (!scheduleResult.success) {
      logger.error(
        `[${requestId}] Failed to create schedule for workflow ${id}: ${scheduleResult.error}`
      )
    } else if (scheduleResult.scheduleId) {
      scheduleInfo = {
        scheduleId: scheduleResult.scheduleId,
        cronExpression: scheduleResult.cronExpression,
        nextRunAt: scheduleResult.nextRunAt,
      }
      logger.info(
        `[${requestId}] Schedule created for workflow ${id}: ${scheduleResult.scheduleId}`
      )
    }

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

    // Sync MCP tools with the latest parameter schema
    await syncMcpToolsOnDeploy(id, requestId)

    const responseApiKeyInfo = workflowData!.workspaceId
      ? 'Workspace API keys'
      : 'Personal API keys'

    return createSuccessResponse({
      apiKey: responseApiKeyInfo,
      isDeployed: true,
      deployedAt,
      schedule: scheduleInfo.scheduleId
        ? {
            id: scheduleInfo.scheduleId,
            cronExpression: scheduleInfo.cronExpression,
            nextRunAt: scheduleInfo.nextRunAt,
          }
        : undefined,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying workflow: ${id}`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause,
      fullError: error,
    })
    return createErrorResponse(error.message || 'Failed to deploy workflow', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Undeploying workflow: ${id}`)

    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    await db.transaction(async (tx) => {
      await deleteSchedulesForWorkflow(id, tx)

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, id))

      await tx
        .update(workflow)
        .set({ isDeployed: false, deployedAt: null })
        .where(eq(workflow.id, id))
    })

    // Remove all MCP tools that reference this workflow
    await removeMcpToolsOnUndeploy(id, requestId)

    logger.info(`[${requestId}] Workflow undeployed successfully: ${id}`)

    try {
      const { trackPlatformEvent } = await import('@/lib/core/telemetry')
      trackPlatformEvent('platform.workflow.undeployed', {
        'workflow.id': id,
      })
    } catch (_e) {
      // Silently fail
    }

    return createSuccessResponse({
      isDeployed: false,
      deployedAt: null,
      apiKey: null,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error undeploying workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to undeploy workflow', 500)
  }
}
