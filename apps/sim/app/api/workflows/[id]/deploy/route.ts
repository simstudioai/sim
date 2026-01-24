import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { removeMcpToolsForWorkflow, syncMcpToolsForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import {
  cleanupWebhooksForWorkflow,
  restorePreviousVersionWebhooks,
  saveTriggerWebhooksForDeploy,
} from '@/lib/webhooks/deploy'
import {
  deployWorkflow,
  loadWorkflowFromNormalizedTables,
  undeployWorkflow,
} from '@/lib/workflows/persistence/utils'
import {
  cleanupDeploymentVersion,
  createSchedulesForDeploy,
  validateWorkflowSchedules,
} from '@/lib/workflows/schedules'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

    const [currentActiveVersion] = await db
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)
    const previousVersionId = currentActiveVersion?.id

    const deployResult = await deployWorkflow({
      workflowId: id,
      deployedBy: actorUserId,
      workflowName: workflowData!.name,
    })

    if (!deployResult.success) {
      return createErrorResponse(deployResult.error || 'Failed to deploy workflow', 500)
    }

    const deployedAt = deployResult.deployedAt!
    const deploymentVersionId = deployResult.deploymentVersionId

    if (!deploymentVersionId) {
      await undeployWorkflow({ workflowId: id })
      return createErrorResponse('Failed to resolve deployment version', 500)
    }

    const triggerSaveResult = await saveTriggerWebhooksForDeploy({
      request,
      workflowId: id,
      workflow: workflowData,
      userId: actorUserId,
      blocks: normalizedData.blocks,
      requestId,
      deploymentVersionId,
      previousVersionId,
    })

    if (!triggerSaveResult.success) {
      await cleanupDeploymentVersion({
        workflowId: id,
        workflow: workflowData as Record<string, unknown>,
        requestId,
        deploymentVersionId,
      })
      await undeployWorkflow({ workflowId: id })
      return createErrorResponse(
        triggerSaveResult.error?.message || 'Failed to save trigger configuration',
        triggerSaveResult.error?.status || 500
      )
    }

    let scheduleInfo: { scheduleId?: string; cronExpression?: string; nextRunAt?: Date } = {}
    const scheduleResult = await createSchedulesForDeploy(
      id,
      normalizedData.blocks,
      db,
      deploymentVersionId
    )
    if (!scheduleResult.success) {
      logger.error(
        `[${requestId}] Failed to create schedule for workflow ${id}: ${scheduleResult.error}`
      )
      await cleanupDeploymentVersion({
        workflowId: id,
        workflow: workflowData as Record<string, unknown>,
        requestId,
        deploymentVersionId,
      })
      if (previousVersionId) {
        await restorePreviousVersionWebhooks({
          request,
          workflow: workflowData as Record<string, unknown>,
          userId: actorUserId,
          previousVersionId,
          requestId,
        })
      }
      await undeployWorkflow({ workflowId: id })
      return createErrorResponse(scheduleResult.error || 'Failed to create schedule', 500)
    }
    if (scheduleResult.scheduleId) {
      scheduleInfo = {
        scheduleId: scheduleResult.scheduleId,
        cronExpression: scheduleResult.cronExpression,
        nextRunAt: scheduleResult.nextRunAt,
      }
      logger.info(
        `[${requestId}] Schedule created for workflow ${id}: ${scheduleResult.scheduleId}`
      )
    }

    if (previousVersionId && previousVersionId !== deploymentVersionId) {
      try {
        logger.info(`[${requestId}] Cleaning up previous version ${previousVersionId} DB records`)
        await cleanupDeploymentVersion({
          workflowId: id,
          workflow: workflowData as Record<string, unknown>,
          requestId,
          deploymentVersionId: previousVersionId,
          skipExternalCleanup: true,
        })
      } catch (cleanupError) {
        logger.error(
          `[${requestId}] Failed to clean up previous version ${previousVersionId}`,
          cleanupError
        )
        // Non-fatal - continue with success response
      }
    }

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

    // Sync MCP tools with the latest parameter schema
    await syncMcpToolsForWorkflow({ workflowId: id, requestId, context: 'deploy' })

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
      warnings: triggerSaveResult.warnings,
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

    const { error, workflow: workflowData } = await validateWorkflowPermissions(
      id,
      requestId,
      'admin'
    )
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    // Clean up external webhook subscriptions before undeploying
    await cleanupWebhooksForWorkflow(id, workflowData as Record<string, unknown>, requestId)

    const result = await undeployWorkflow({ workflowId: id })
    if (!result.success) {
      return createErrorResponse(result.error || 'Failed to undeploy workflow', 500)
    }

    await removeMcpToolsForWorkflow(id, requestId)

    logger.info(`[${requestId}] Workflow undeployed successfully: ${id}`)

    try {
      const { PlatformEvents } = await import('@/lib/core/telemetry')
      PlatformEvents.workflowUndeployed({ workflowId: id })
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
