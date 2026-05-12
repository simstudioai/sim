import { db, workflowDeploymentVersion, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { Cron } from 'croner'
import { and, eq, inArray, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  executeJobInline,
  executeScheduleJob,
  releaseScheduleLock,
} from '@/background/schedule-execution'

export const dynamic = 'force-dynamic'
export const maxDuration = 3600

const logger = createLogger('ScheduledExecuteAPI')
const MAX_CRON_CLAIMS = 200
const RESERVED_WORKFLOW_CLAIMS = 100
const RESERVED_JOB_CLAIMS = MAX_CRON_CLAIMS - RESERVED_WORKFLOW_CLAIMS
const STALE_SCHEDULE_CLAIM_MS = getMaxExecutionTimeout()

const dueFilter = (queuedAt: Date) =>
  and(
    isNull(workflowSchedule.archivedAt),
    lte(workflowSchedule.nextRunAt, queuedAt),
    not(eq(workflowSchedule.status, 'disabled')),
    ne(workflowSchedule.status, 'completed'),
    or(
      isNull(workflowSchedule.lastQueuedAt),
      lt(workflowSchedule.lastQueuedAt, workflowSchedule.nextRunAt),
      lt(workflowSchedule.lastQueuedAt, new Date(queuedAt.getTime() - STALE_SCHEDULE_CLAIM_MS))
    )
  )

const activeWorkflowDeploymentFilter = () =>
  sql`${workflowSchedule.deploymentVersionId} = (select ${workflowDeploymentVersion.id} from ${workflowDeploymentVersion} where ${workflowDeploymentVersion.workflowId} = ${workflowSchedule.workflowId} and ${workflowDeploymentVersion.isActive} = true)`

const workflowScheduleFilter = (queuedAt: Date) =>
  and(
    dueFilter(queuedAt),
    or(eq(workflowSchedule.sourceType, 'workflow'), isNull(workflowSchedule.sourceType)),
    activeWorkflowDeploymentFilter()
  )

const jobScheduleFilter = (queuedAt: Date) =>
  and(dueFilter(queuedAt), eq(workflowSchedule.sourceType, 'job'))

function buildScheduleExecutionJobId(schedule: {
  id: string
  nextRunAt?: Date | null
  lastQueuedAt?: Date | null
}): string {
  const occurrence =
    schedule.nextRunAt?.toISOString() ?? schedule.lastQueuedAt?.toISOString() ?? 'due'
  return `schedule_${sha256Hex(`${schedule.id}:${occurrence}`).slice(0, 32)}`
}

function getNextRunFromCronExpression(cronExpression?: string | null): Date | null {
  if (!cronExpression) return null
  const cron = new Cron(cronExpression)
  return cron.nextRun()
}

async function claimWorkflowSchedules(queuedAt: Date, limit: number) {
  if (limit <= 0) return []

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: workflowSchedule.id })
      .from(workflowSchedule)
      .where(workflowScheduleFilter(queuedAt))
      .for('update', { skipLocked: true })
      .limit(limit)

    if (rows.length === 0) return []

    return tx
      .update(workflowSchedule)
      .set({ lastQueuedAt: queuedAt, updatedAt: queuedAt })
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
        nextRunAt: workflowSchedule.nextRunAt,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        deploymentVersionId: workflowSchedule.deploymentVersionId,
        sourceType: workflowSchedule.sourceType,
      })
  })
}

async function claimJobSchedules(queuedAt: Date, limit: number) {
  if (limit <= 0) return []

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: workflowSchedule.id })
      .from(workflowSchedule)
      .where(jobScheduleFilter(queuedAt))
      .for('update', { skipLocked: true })
      .limit(limit)

    if (rows.length === 0) return []

    return tx
      .update(workflowSchedule)
      .set({ lastQueuedAt: queuedAt, updatedAt: queuedAt })
      .where(
        and(
          jobScheduleFilter(queuedAt),
          inArray(
            workflowSchedule.id,
            rows.map((row) => row.id)
          )
        )
      )
      .returning({
        id: workflowSchedule.id,
        cronExpression: workflowSchedule.cronExpression,
        failedCount: workflowSchedule.failedCount,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        sourceType: workflowSchedule.sourceType,
      })
  })
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(request, 'Schedule execution')
  if (authError) {
    return authError
  }

  const queuedAt = new Date()

  try {
    const dueSchedules = await claimWorkflowSchedules(queuedAt, RESERVED_WORKFLOW_CLAIMS)
    const dueJobs = await claimJobSchedules(queuedAt, RESERVED_JOB_CLAIMS)
    const remainingClaimBudget = Math.max(0, MAX_CRON_CLAIMS - dueSchedules.length - dueJobs.length)

    if (remainingClaimBudget > 0 && dueSchedules.length === RESERVED_WORKFLOW_CLAIMS) {
      dueSchedules.push(...(await claimWorkflowSchedules(queuedAt, remainingClaimBudget)))
    } else if (remainingClaimBudget > 0 && dueJobs.length === RESERVED_JOB_CLAIMS) {
      dueJobs.push(...(await claimJobSchedules(queuedAt, remainingClaimBudget)))
    }

    const totalCount = dueSchedules.length + dueJobs.length
    logger.info(
      `[${requestId}] Processing ${totalCount} due items (${dueSchedules.length} schedules, ${dueJobs.length} jobs)`
    )

    const jobQueue = await getJobQueue()

    const workflowUtils =
      dueSchedules.length > 0 ? await import('@/lib/workflows/utils') : undefined

    const schedulePromises = dueSchedules.map(async (schedule) => {
      const queueTime = schedule.lastQueuedAt ?? queuedAt
      const executionId = generateId()
      const correlation = {
        executionId,
        requestId,
        source: 'schedule' as const,
        workflowId: schedule.workflowId!,
        scheduleId: schedule.id,
        triggerType: 'schedule',
        scheduledFor: schedule.nextRunAt?.toISOString(),
      }

      const payload = {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId!,
        executionId,
        requestId,
        correlation,
        blockId: schedule.blockId || undefined,
        deploymentVersionId: schedule.deploymentVersionId || undefined,
        cronExpression: schedule.cronExpression || undefined,
        lastRanAt: schedule.lastRanAt?.toISOString(),
        failedCount: schedule.failedCount || 0,
        now: queueTime.toISOString(),
        scheduledFor: schedule.nextRunAt?.toISOString(),
      }

      try {
        const scheduleJobId = buildScheduleExecutionJobId(schedule)
        const existingJob = await jobQueue.getJob(scheduleJobId)
        if (existingJob && ['pending', 'processing'].includes(existingJob.status)) {
          logger.info(`[${requestId}] Schedule execution job already exists`, {
            scheduleId: schedule.id,
            jobId: scheduleJobId,
            status: existingJob.status,
          })
          return
        }
        if (existingJob) {
          logger.info(`[${requestId}] Releasing stale schedule claim for finished job`, {
            scheduleId: schedule.id,
            jobId: scheduleJobId,
            status: existingJob.status,
          })
          await releaseScheduleLock(
            schedule.id,
            requestId,
            queuedAt,
            `Released stale schedule ${schedule.id} for finished job ${scheduleJobId}`,
            getNextRunFromCronExpression(schedule.cronExpression)
          )
          return
        }

        const resolvedWorkflow = schedule.workflowId
          ? await workflowUtils?.getWorkflowById(schedule.workflowId)
          : null
        const resolvedWorkspaceId = resolvedWorkflow?.workspaceId

        const jobId = await jobQueue.enqueue('schedule-execution', payload, {
          jobId: scheduleJobId,
          concurrencyKey: scheduleJobId,
          metadata: {
            workflowId: schedule.workflowId ?? undefined,
            workspaceId: resolvedWorkspaceId ?? undefined,
            correlation,
          },
        })
        logger.info(
          `[${requestId}] Queued schedule execution task ${jobId} for workflow ${schedule.workflowId}`
        )

        const queuedJob = await jobQueue.getJob(jobId)
        if (queuedJob && !['pending', 'processing'].includes(queuedJob.status)) {
          logger.info(`[${requestId}] Schedule execution job already finished`, {
            scheduleId: schedule.id,
            jobId,
            status: queuedJob.status,
          })
          await releaseScheduleLock(
            schedule.id,
            requestId,
            queuedAt,
            `Released stale schedule ${schedule.id} for finished job ${jobId}`,
            getNextRunFromCronExpression(schedule.cronExpression)
          )
          return
        }

        if (shouldExecuteInline()) {
          try {
            await jobQueue.startJob(jobId)
            const output = await executeScheduleJob(payload)
            await jobQueue.completeJob(jobId, output)
          } catch (error) {
            const errorMessage = toError(error).message
            logger.error(
              `[${requestId}] Schedule execution failed for workflow ${schedule.workflowId}`,
              {
                jobId,
                error: errorMessage,
              }
            )
            try {
              await jobQueue.markJobFailed(jobId, errorMessage)
            } catch (markFailedError) {
              logger.error(`[${requestId}] Failed to mark job as failed`, {
                jobId,
                error:
                  markFailedError instanceof Error
                    ? markFailedError.message
                    : String(markFailedError),
              })
            }
            await releaseScheduleLock(
              schedule.id,
              requestId,
              queuedAt,
              `Failed to release lock for schedule ${schedule.id} after inline execution failure`
            )
          }
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to queue schedule execution for workflow ${schedule.workflowId}`,
          error
        )
        await releaseScheduleLock(
          schedule.id,
          requestId,
          queuedAt,
          `Failed to release lock for schedule ${schedule.id} after queue failure`
        )
      }
    })

    // Mothership jobs are executed inline directly.
    const jobPromises = dueJobs.map(async (job) => {
      const queueTime = job.lastQueuedAt ?? queuedAt
      const payload = {
        scheduleId: job.id,
        cronExpression: job.cronExpression || undefined,
        failedCount: job.failedCount || 0,
        now: queueTime.toISOString(),
      }

      try {
        await executeJobInline(payload)
      } catch (error) {
        logger.error(`[${requestId}] Job execution failed for ${job.id}`, {
          error: toError(error).message,
        })
        await releaseScheduleLock(
          job.id,
          requestId,
          queuedAt,
          `Failed to release lock for job ${job.id}`
        )
      }
    })

    await Promise.allSettled([...schedulePromises, ...jobPromises])

    logger.info(`[${requestId}] Processed ${totalCount} items`)

    return NextResponse.json({
      message: 'Scheduled workflow executions processed',
      executedCount: totalCount,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error in scheduled execution handler`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
})
