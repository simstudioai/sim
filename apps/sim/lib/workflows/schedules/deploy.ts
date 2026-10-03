import { db, workflow, workflowDeploymentVersion, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  type DeploymentOperationFence,
  getProtectedDeploymentVersionId,
  isDeploymentOperationCurrent,
  setDeploymentTxTimeouts,
} from '@/lib/workflows/persistence/deployment-operations'
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
 * Create or update schedule records for a workflow during deployment.
 * Atomic either way: writes run inside the caller's transaction when `tx`
 * is provided, otherwise inside a transaction opened here.
 */
export async function createSchedulesForDeploy(
  workflowId: string,
  blocks: Record<string, BlockState>,
  tx?: DbOrTx,
  deploymentVersionId?: string,
  deploymentOperationId?: string
): Promise<ScheduleDeployResult> {
  const scheduleBlocks = findScheduleBlocks(blocks)

  if (scheduleBlocks.length === 0) {
    logger.info(`No schedule blocks found in workflow ${workflowId}`)
    return { success: true }
  }

  // Phase 1: Validate ALL blocks before making any DB changes
  const validatedBlocks: Array<{
    blockId: string
    cronExpression: string
    nextRunAt: Date
    timezone: string
  }> = []

  for (const block of scheduleBlocks) {
    const blockId = block.id as string
    const validation = validateScheduleBlock(block)
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
      }
    }
    validatedBlocks.push({
      blockId,
      cronExpression: validation.cronExpression!,
      nextRunAt: validation.nextRunAt!,
      timezone: validation.timezone!,
    })
  }

  // Phase 2: All validations passed - now do DB operations in a transaction
  let lastScheduleInfo: {
    scheduleId: string
    cronExpression?: string
    nextRunAt?: Date
    timezone?: string
  } | null = null

  try {
    const writeSchedules = async (trx: DbOrTx) => {
      const currentBlockIds = new Set(validatedBlocks.map((b) => b.blockId))

      const existingSchedules = await trx
        .select({ id: workflowSchedule.id, blockId: workflowSchedule.blockId })
        .from(workflowSchedule)
        .where(
          deploymentVersionId
            ? and(
                eq(workflowSchedule.workflowId, workflowId),
                eq(workflowSchedule.deploymentVersionId, deploymentVersionId),
                isNull(workflowSchedule.archivedAt)
              )
            : and(eq(workflowSchedule.workflowId, workflowId), isNull(workflowSchedule.archivedAt))
        )

      const orphanedScheduleIds = existingSchedules
        .filter((s) => s.blockId && !currentBlockIds.has(s.blockId))
        .map((s) => s.id)

      if (orphanedScheduleIds.length > 0) {
        logger.info(
          `Deleting ${orphanedScheduleIds.length} orphaned schedule(s) for workflow ${workflowId}`
        )
        await trx.delete(workflowSchedule).where(inArray(workflowSchedule.id, orphanedScheduleIds))
      }

      for (const validated of validatedBlocks) {
        const { blockId, cronExpression, nextRunAt, timezone } = validated
        const scheduleId = generateId()
        const now = new Date()

        const values = {
          id: scheduleId,
          workflowId,
          deploymentVersionId: deploymentVersionId || null,
          deploymentOperationId: deploymentOperationId || null,
          blockId,
          cronExpression,
          triggerType: 'schedule',
          createdAt: now,
          updatedAt: now,
          nextRunAt,
          timezone,
          status: 'active',
          failedCount: 0,
          infraRetryCount: 0,
        }

        const setValues = {
          blockId,
          cronExpression,
          ...(deploymentVersionId ? { deploymentVersionId } : {}),
          ...(deploymentOperationId ? { deploymentOperationId } : {}),
          updatedAt: now,
          nextRunAt,
          timezone,
          status: 'active',
          failedCount: 0,
          infraRetryCount: 0,
        }

        await trx
          .insert(workflowSchedule)
          .values(values)
          .onConflictDoUpdate({
            target: [
              workflowSchedule.workflowId,
              workflowSchedule.blockId,
              workflowSchedule.deploymentVersionId,
            ],
            targetWhere: isNull(workflowSchedule.archivedAt),
            set: setValues,
          })

        logger.info(`Schedule created/updated for workflow ${workflowId}, block ${blockId}`, {
          scheduleId: values.id,
          cronExpression,
          nextRunAt: nextRunAt?.toISOString(),
        })

        lastScheduleInfo = { scheduleId: values.id, cronExpression, nextRunAt, timezone }
      }
    }

    // The global client is not a transaction — wrap it so the atomicity
    // contract holds even if a caller passes `db` explicitly.
    await (tx && tx !== db ? writeSchedules(tx) : db.transaction(writeSchedules))
  } catch (error) {
    logger.error(`Failed to create schedules for workflow ${workflowId}`, error)
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to create schedules'),
    }
  }

  return {
    success: true,
    ...(lastScheduleInfo ?? {}),
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
            eq(workflowSchedule.deploymentVersionId, deploymentVersionId),
            isNull(workflowSchedule.archivedAt)
          )
        : and(eq(workflowSchedule.workflowId, workflowId), isNull(workflowSchedule.archivedAt))
    )

  logger.info(
    deploymentVersionId
      ? `Deleted schedules for workflow ${workflowId} deployment ${deploymentVersionId}`
      : `Deleted all schedules for workflow ${workflowId}`
  )
}

export type InactiveDeploymentScheduleCleanupResult =
  | { status: 'deleted'; count: number }
  | { status: 'superseded' }

/**
 * Deletes every schedule still owned by an inactive deployment version of the
 * workflow in one fenced statement. Keyed by schedule rows rather than by
 * versions, so the cost follows what is stale instead of how many times the
 * workflow has been deployed. The version an in-flight operation is preparing
 * is left alone: it is inactive until cutover, but its schedules are live
 * preparation state. The workflow row lock serializes this with activation so
 * `isActive` cannot flip underneath the delete.
 */
export async function deleteInactiveDeploymentSchedules(params: {
  workflowId: string
  /** When set, nothing is deleted once a newer operation has taken over the workflow. */
  operationFence?: DeploymentOperationFence
}): Promise<InactiveDeploymentScheduleCleanupResult> {
  return db.transaction(async (tx) => {
    await setDeploymentTxTimeouts(tx)
    await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, params.workflowId))
      .for('update')
    if (params.operationFence && !(await isDeploymentOperationCurrent(params.operationFence, tx))) {
      return { status: 'superseded' }
    }

    const protectedDeploymentVersionId = await getProtectedDeploymentVersionId(
      params.workflowId,
      tx
    )
    const inactiveVersionIds = tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.isActive, false)
        )
      )
    const deleted = await tx
      .delete(workflowSchedule)
      .where(
        and(
          eq(workflowSchedule.workflowId, params.workflowId),
          isNull(workflowSchedule.archivedAt),
          inArray(workflowSchedule.deploymentVersionId, inactiveVersionIds),
          protectedDeploymentVersionId
            ? ne(workflowSchedule.deploymentVersionId, protectedDeploymentVersionId)
            : undefined
        )
      )
      .returning({ id: workflowSchedule.id })

    if (deleted.length > 0) {
      logger.info(
        `Deleted ${deleted.length} schedule(s) owned by inactive deployments of workflow ${params.workflowId}`
      )
    }
    return { status: 'deleted', count: deleted.length }
  })
}
