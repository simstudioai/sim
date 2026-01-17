import { db, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { cleanupWebhooksForWorkflow } from '@/lib/webhooks/deploy'
import type { BlockState } from '@/lib/workflows/schedules/utils'
import { findScheduleBlocks, validateScheduleBlock } from '@/lib/workflows/schedules/validation'

const logger = createLogger('ScheduleDeployUtils')

/**
 * Result of schedule creation during deploy
 */
export interface ScheduleDeployResult {
  success: boolean
  error?: string
  scheduleId?: string
  cronExpression?: string
  nextRunAt?: Date
  timezone?: string
}

/**
 * Create or update schedule records for a workflow during deployment
 * This should be called within a database transaction
 */
export async function createSchedulesForDeploy(
  workflowId: string,
  blocks: Record<string, BlockState>,
  tx: DbOrTx,
  deploymentVersionId?: string
): Promise<ScheduleDeployResult> {
  const scheduleBlocks = findScheduleBlocks(blocks)

  if (scheduleBlocks.length === 0) {
    logger.info(`No schedule blocks found in workflow ${workflowId}`)
    return { success: true }
  }

  let lastScheduleInfo: {
    scheduleId: string
    cronExpression?: string
    nextRunAt?: Date
    timezone?: string
  } | null = null

  for (const block of scheduleBlocks) {
    const blockId = block.id as string

    const validation = validateScheduleBlock(block)
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
      }
    }

    const { cronExpression, nextRunAt, timezone } = validation

    const scheduleId = crypto.randomUUID()
    const now = new Date()

    const values = {
      id: scheduleId,
      workflowId,
      deploymentVersionId: deploymentVersionId || null,
      blockId,
      cronExpression: cronExpression!,
      triggerType: 'schedule',
      createdAt: now,
      updatedAt: now,
      nextRunAt: nextRunAt!,
      timezone: timezone!,
      status: 'active',
      failedCount: 0,
    }

    const setValues = {
      blockId,
      cronExpression: cronExpression!,
      ...(deploymentVersionId ? { deploymentVersionId } : {}),
      updatedAt: now,
      nextRunAt: nextRunAt!,
      timezone: timezone!,
      status: 'active',
      failedCount: 0,
    }

    await tx
      .insert(workflowSchedule)
      .values(values)
      .onConflictDoUpdate({
        target: [
          workflowSchedule.workflowId,
          workflowSchedule.blockId,
          workflowSchedule.deploymentVersionId,
        ],
        set: setValues,
      })

    logger.info(`Schedule created/updated for workflow ${workflowId}, block ${blockId}`, {
      scheduleId: values.id,
      cronExpression,
      nextRunAt: nextRunAt?.toISOString(),
    })

    lastScheduleInfo = { scheduleId: values.id, cronExpression, nextRunAt, timezone }
  }

  return {
    success: true,
    ...lastScheduleInfo,
  }
}

/**
 * Delete all schedules for a workflow
 * This should be called within a database transaction during undeploy
 */
export async function deleteSchedulesForWorkflow(
  workflowId: string,
  tx: DbOrTx,
  deploymentVersionId?: string
): Promise<void> {
  await tx
    .delete(workflowSchedule)
    .where(
      deploymentVersionId
        ? and(
            eq(workflowSchedule.workflowId, workflowId),
            eq(workflowSchedule.deploymentVersionId, deploymentVersionId)
          )
        : eq(workflowSchedule.workflowId, workflowId)
    )

  logger.info(
    deploymentVersionId
      ? `Deleted schedules for workflow ${workflowId} deployment ${deploymentVersionId}`
      : `Deleted all schedules for workflow ${workflowId}`
  )
}

export async function cleanupDeploymentVersion(params: {
  workflowId: string
  workflow: Record<string, unknown>
  requestId: string
  deploymentVersionId: string
}): Promise<void> {
  const { workflowId, workflow, requestId, deploymentVersionId } = params
  await cleanupWebhooksForWorkflow(workflowId, workflow, requestId, deploymentVersionId)
  await deleteSchedulesForWorkflow(workflowId, db, deploymentVersionId)
}
