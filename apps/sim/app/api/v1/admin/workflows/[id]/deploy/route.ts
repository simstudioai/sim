import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
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
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminDeployResult, AdminUndeployResult } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowDeployAPI')

const ADMIN_ACTOR_ID = 'admin-api'

interface RouteParams {
  id: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workflowId } = await context.params
  const requestId = generateRequestId()

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return notFoundResponse('Workflow')
    }

    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalizedData) {
      return badRequestResponse('Workflow has no saved state')
    }

    const scheduleValidation = validateWorkflowSchedules(normalizedData.blocks)
    if (!scheduleValidation.isValid) {
      return badRequestResponse(`Invalid schedule configuration: ${scheduleValidation.error}`)
    }

    const [currentActiveVersion] = await db
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)
    const previousVersionId = currentActiveVersion?.id

    const deployResult = await deployWorkflow({
      workflowId,
      deployedBy: ADMIN_ACTOR_ID,
      workflowName: workflowRecord.name,
    })

    if (!deployResult.success) {
      return internalErrorResponse(deployResult.error || 'Failed to deploy workflow')
    }

    if (!deployResult.deploymentVersionId) {
      await undeployWorkflow({ workflowId })
      return internalErrorResponse('Failed to resolve deployment version')
    }

    const workflowData = workflowRecord as Record<string, unknown>

    const triggerSaveResult = await saveTriggerWebhooksForDeploy({
      request,
      workflowId,
      workflow: workflowData,
      userId: workflowRecord.userId,
      blocks: normalizedData.blocks,
      requestId,
      deploymentVersionId: deployResult.deploymentVersionId,
      previousVersionId,
    })

    if (!triggerSaveResult.success) {
      await cleanupDeploymentVersion({
        workflowId,
        workflow: workflowData,
        requestId,
        deploymentVersionId: deployResult.deploymentVersionId,
      })
      await undeployWorkflow({ workflowId })
      return internalErrorResponse(
        triggerSaveResult.error?.message || 'Failed to sync trigger configuration'
      )
    }

    const scheduleResult = await createSchedulesForDeploy(
      workflowId,
      normalizedData.blocks,
      db,
      deployResult.deploymentVersionId
    )
    if (!scheduleResult.success) {
      logger.error(
        `[${requestId}] Admin API: Schedule creation failed for workflow ${workflowId}: ${scheduleResult.error}`
      )
      await cleanupDeploymentVersion({
        workflowId,
        workflow: workflowData,
        requestId,
        deploymentVersionId: deployResult.deploymentVersionId,
      })
      if (previousVersionId) {
        await restorePreviousVersionWebhooks({
          request,
          workflow: workflowData,
          userId: workflowRecord.userId,
          previousVersionId,
          requestId,
        })
      }
      await undeployWorkflow({ workflowId })
      return internalErrorResponse(scheduleResult.error || 'Failed to create schedule')
    }

    if (previousVersionId && previousVersionId !== deployResult.deploymentVersionId) {
      try {
        logger.info(`[${requestId}] Admin API: Cleaning up previous version ${previousVersionId}`)
        await cleanupDeploymentVersion({
          workflowId,
          workflow: workflowData,
          requestId,
          deploymentVersionId: previousVersionId,
          skipExternalCleanup: true,
        })
      } catch (cleanupError) {
        logger.error(
          `[${requestId}] Admin API: Failed to clean up previous version ${previousVersionId}`,
          cleanupError
        )
      }
    }

    logger.info(
      `[${requestId}] Admin API: Deployed workflow ${workflowId} as v${deployResult.version}`
    )

    // Sync MCP tools with the latest parameter schema
    await syncMcpToolsForWorkflow({ workflowId, requestId, context: 'deploy' })

    const response: AdminDeployResult = {
      isDeployed: true,
      version: deployResult.version!,
      deployedAt: deployResult.deployedAt!.toISOString(),
      warnings: triggerSaveResult.warnings,
    }

    return singleResponse(response)
  } catch (error) {
    logger.error(`Admin API: Failed to deploy workflow ${workflowId}`, { error })
    return internalErrorResponse('Failed to deploy workflow')
  }
})

export const DELETE = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workflowId } = await context.params
  const requestId = generateRequestId()

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return notFoundResponse('Workflow')
    }

    await cleanupWebhooksForWorkflow(
      workflowId,
      workflowRecord as Record<string, unknown>,
      requestId
    )

    const result = await undeployWorkflow({ workflowId })
    if (!result.success) {
      return internalErrorResponse(result.error || 'Failed to undeploy workflow')
    }

    await removeMcpToolsForWorkflow(workflowId, requestId)

    logger.info(`Admin API: Undeployed workflow ${workflowId}`)

    const response: AdminUndeployResult = {
      isDeployed: false,
    }

    return singleResponse(response)
  } catch (error) {
    logger.error(`Admin API: Failed to undeploy workflow ${workflowId}`, { error })
    return internalErrorResponse('Failed to undeploy workflow')
  }
})
