import { db, workflow, workflowDeploymentVersion, workflowSchedule } from '@sim/db'
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

/**
 * How long a schedule may hold the claim on its current occurrence before a tick re-examines it.
 * It has to outlast one tick's handoff; re-examining is safe because the tick resolves the
 * occurrence through its carrier's deterministic job id rather than dispatching it again blindly.
 */
const SCHEDULE_CLAIM_RECHECK_MS = 10 * 60 * 1000

/**
 * A claim held on the current occurrence (`lastQueuedAt >= nextRunAt`) is the run's identity: the
 * worker's claim-guarded writes match it exactly, so a re-examination keeps it and moves only
 * `updatedAt`, which serves as the re-check clock.
 */
const holdsCurrentOccurrenceClaim = sql`${workflowSchedule.lastQueuedAt} >= ${workflowSchedule.nextRunAt}`

const dueFilter = (queuedAt: Date) =>
  and(
    isNull(workflowSchedule.archivedAt),
    lte(workflowSchedule.nextRunAt, queuedAt),
    sql`${workflowSchedule.status} NOT IN ('disabled', 'completed')`,
    or(
      isNull(workflowSchedule.lastQueuedAt),
      lt(workflowSchedule.lastQueuedAt, workflowSchedule.nextRunAt),
      lt(workflowSchedule.updatedAt, new Date(queuedAt.getTime() - SCHEDULE_CLAIM_RECHECK_MS))
    )
  )

const activeWorkflowDeploymentFilter = () =>
  sql`${workflowSchedule.deploymentVersionId} = (select ${workflowDeploymentVersion.id} from ${workflowDeploymentVersion} where ${workflowDeploymentVersion.workflowId} = ${workflowSchedule.workflowId} and ${workflowDeploymentVersion.isActive} = true)`

const workflowScheduleFilter = (queuedAt: Date) =>
  and(
    dueFilter(queuedAt),
    sql`(${workflowSchedule.sourceType} = 'workflow' OR ${workflowSchedule.sourceType} IS NULL)`,
    activeWorkflowDeploymentFilter()
  )

/**
 * Claims up to `limit` due workflow schedules on their live deployment, including any whose claim
 * on the current occurrence has gone {@link SCHEDULE_CLAIM_RECHECK_MS} without a re-examination.
 * Concurrent ticks skip each other's locked rows.
 */
export async function claimDueWorkflowSchedules(queuedAt: Date, limit: number) {
  if (limit <= 0) return []

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: workflowSchedule.id,
        workspaceId: workflow.workspaceId,
      })
      .from(workflowSchedule)
      .innerJoin(workflow, eq(workflowSchedule.workflowId, workflow.id))
      .where(workflowScheduleFilter(queuedAt))
      .for('update', { skipLocked: true })
      .limit(limit)

    if (rows.length === 0) return []
    const workspaceIdsByScheduleId = new Map(rows.map((row) => [row.id, row.workspaceId]))

    const claimedRows = await tx
      .update(workflowSchedule)
      .set({
        lastQueuedAt: sql`CASE WHEN ${holdsCurrentOccurrenceClaim} THEN ${workflowSchedule.lastQueuedAt} ELSE ${sql.param(queuedAt, workflowSchedule.lastQueuedAt)} END`,
        updatedAt: queuedAt,
      })
      .where(
        and(
          workflowScheduleFilter(queuedAt),
          inArray(
            workflowSchedule.id,
            rows.map((row) => row.id)
          )
        )
      )
      .returning({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        blockId: workflowSchedule.blockId,
        cronExpression: workflowSchedule.cronExpression,
        lastRanAt: workflowSchedule.lastRanAt,
        failedCount: workflowSchedule.failedCount,
        infraRetryCount: workflowSchedule.infraRetryCount,
        nextRunAt: workflowSchedule.nextRunAt,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        timezone: workflowSchedule.timezone,
        deploymentVersionId: workflowSchedule.deploymentVersionId,
        deploymentOperationId: workflowSchedule.deploymentOperationId,
        sourceType: workflowSchedule.sourceType,
      })

    return claimedRows.map((row) => ({
      ...row,
      workspaceId: workspaceIdsByScheduleId.get(row.id) ?? null,
    }))
  })
}

export type ClaimedWorkflowSchedule = Awaited<ReturnType<typeof claimDueWorkflowSchedules>>[number]
