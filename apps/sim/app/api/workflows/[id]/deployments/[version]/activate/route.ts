import { db, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { syncMcpToolsForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { restorePreviousVersionWebhooks, saveTriggerWebhooksForDeploy } from '@/lib/webhooks/deploy'
import { activateWorkflowVersion } from '@/lib/workflows/persistence/utils'
import {
  cleanupDeploymentVersion,
  createSchedulesForDeploy,
  validateWorkflowSchedules,
} from '@/lib/workflows/schedules'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowActivateDeploymentAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const actorUserId = session?.user?.id
    if (!actorUserId) {
      logger.warn(`[${requestId}] Unable to resolve actor user for deployment activation: ${id}`)
      return createErrorResponse('Unable to determine activating user', 400)
    }

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version number', 400)
    }

    const [versionRow] = await db
      .select({
        id: workflowDeploymentVersion.id,
        state: workflowDeploymentVersion.state,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .limit(1)

    if (!versionRow?.state) {
      return createErrorResponse('Deployment version not found', 404)
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

    const deployedState = versionRow.state as { blocks?: Record<string, BlockState> }
    const blocks = deployedState.blocks
    if (!blocks || typeof blocks !== 'object') {
      return createErrorResponse('Invalid deployed state structure', 500)
    }

    const scheduleValidation = validateWorkflowSchedules(blocks)
    if (!scheduleValidation.isValid) {
      return createErrorResponse(`Invalid schedule configuration: ${scheduleValidation.error}`, 400)
    }

    const triggerSaveResult = await saveTriggerWebhooksForDeploy({
      request,
      workflowId: id,
      workflow: workflowData as Record<string, unknown>,
      userId: actorUserId,
      blocks,
      requestId,
      deploymentVersionId: versionRow.id,
      previousVersionId,
      forceRecreateSubscriptions: true,
    })

    if (!triggerSaveResult.success) {
      return createErrorResponse(
        triggerSaveResult.error?.message || 'Failed to sync trigger configuration',
        triggerSaveResult.error?.status || 500
      )
    }

    const scheduleResult = await createSchedulesForDeploy(id, blocks, db, versionRow.id)

    if (!scheduleResult.success) {
      await cleanupDeploymentVersion({
        workflowId: id,
        workflow: workflowData as Record<string, unknown>,
        requestId,
        deploymentVersionId: versionRow.id,
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
      return createErrorResponse(scheduleResult.error || 'Failed to sync schedules', 500)
    }

    const result = await activateWorkflowVersion({ workflowId: id, version: versionNum })
    if (!result.success) {
      await cleanupDeploymentVersion({
        workflowId: id,
        workflow: workflowData as Record<string, unknown>,
        requestId,
        deploymentVersionId: versionRow.id,
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
      return createErrorResponse(result.error || 'Failed to activate deployment', 400)
    }

    if (previousVersionId && previousVersionId !== versionRow.id) {
      try {
        logger.info(
          `[${requestId}] Cleaning up previous version ${previousVersionId} webhooks/schedules`
        )
        await cleanupDeploymentVersion({
          workflowId: id,
          workflow: workflowData as Record<string, unknown>,
          requestId,
          deploymentVersionId: previousVersionId,
          skipExternalCleanup: true,
        })
        logger.info(`[${requestId}] Previous version cleanup completed`)
      } catch (cleanupError) {
        logger.error(
          `[${requestId}] Failed to clean up previous version ${previousVersionId}`,
          cleanupError
        )
      }
    }

    await syncMcpToolsForWorkflow({
      workflowId: id,
      requestId,
      state: versionRow.state,
      context: 'activate',
    })

    return createSuccessResponse({
      success: true,
      deployedAt: result.deployedAt,
      warnings: triggerSaveResult.warnings,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error activating deployment for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to activate deployment', 500)
  }
}
