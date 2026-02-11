import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { syncMcpToolsForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { restorePreviousVersionWebhooks, saveTriggerWebhooksForDeploy } from '@/lib/webhooks/deploy'
import { activateWorkflowVersion } from '@/lib/workflows/persistence/utils'
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
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AdminWorkflowActivateVersionAPI')

interface RouteParams {
  id: string
  versionId: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const requestId = generateRequestId()
  const { id: workflowId, versionId } = await context.params

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return notFoundResponse('Workflow')
    }

    const versionNum = Number(versionId)
    if (!Number.isFinite(versionNum) || versionNum < 1) {
      return badRequestResponse('Invalid version number')
    }

    const [versionRow] = await db
      .select({
        id: workflowDeploymentVersion.id,
        state: workflowDeploymentVersion.state,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .limit(1)

    if (!versionRow?.state) {
      return notFoundResponse('Deployment version')
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

    const deployedState = versionRow.state as { blocks?: Record<string, BlockState> }
    const blocks = deployedState.blocks
    if (!blocks || typeof blocks !== 'object') {
      return internalErrorResponse('Invalid deployed state structure')
    }

    const workflowData = workflowRecord as Record<string, unknown>

    const scheduleValidation = validateWorkflowSchedules(blocks)
    if (!scheduleValidation.isValid) {
      return badRequestResponse(`Invalid schedule configuration: ${scheduleValidation.error}`)
    }

    const triggerSaveResult = await saveTriggerWebhooksForDeploy({
      request,
      workflowId,
      workflow: workflowData,
      userId: workflowRecord.userId,
      blocks,
      requestId,
      deploymentVersionId: versionRow.id,
      previousVersionId,
      forceRecreateSubscriptions: true,
    })

    if (!triggerSaveResult.success) {
      logger.error(
        `[${requestId}] Admin API: Failed to sync triggers for workflow ${workflowId}`,
        triggerSaveResult.error
      )
      return internalErrorResponse(
        triggerSaveResult.error?.message || 'Failed to sync trigger configuration'
      )
    }

    const scheduleResult = await createSchedulesForDeploy(workflowId, blocks, db, versionRow.id)

    if (!scheduleResult.success) {
      await cleanupDeploymentVersion({
        workflowId,
        workflow: workflowData,
        requestId,
        deploymentVersionId: versionRow.id,
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
      return internalErrorResponse(scheduleResult.error || 'Failed to sync schedules')
    }

    const result = await activateWorkflowVersion({ workflowId, version: versionNum })
    if (!result.success) {
      await cleanupDeploymentVersion({
        workflowId,
        workflow: workflowData,
        requestId,
        deploymentVersionId: versionRow.id,
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
      if (result.error === 'Deployment version not found') {
        return notFoundResponse('Deployment version')
      }
      return internalErrorResponse(result.error || 'Failed to activate version')
    }

    if (previousVersionId && previousVersionId !== versionRow.id) {
      try {
        logger.info(
          `[${requestId}] Admin API: Cleaning up previous version ${previousVersionId} webhooks/schedules`
        )
        await cleanupDeploymentVersion({
          workflowId,
          workflow: workflowData,
          requestId,
          deploymentVersionId: previousVersionId,
          skipExternalCleanup: true,
        })
        logger.info(`[${requestId}] Admin API: Previous version cleanup completed`)
      } catch (cleanupError) {
        logger.error(
          `[${requestId}] Admin API: Failed to clean up previous version ${previousVersionId}`,
          cleanupError
        )
      }
    }

    await syncMcpToolsForWorkflow({
      workflowId,
      requestId,
      state: versionRow.state,
      context: 'activate',
    })

    logger.info(
      `[${requestId}] Admin API: Activated version ${versionNum} for workflow ${workflowId}`
    )

    return singleResponse({
      success: true,
      version: versionNum,
      deployedAt: result.deployedAt!.toISOString(),
      warnings: triggerSaveResult.warnings,
    })
  } catch (error) {
    logger.error(
      `[${requestId}] Admin API: Failed to activate version for workflow ${workflowId}`,
      {
        error,
      }
    )
    return internalErrorResponse('Failed to activate deployment version')
  }
})
