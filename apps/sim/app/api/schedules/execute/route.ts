import { db, workflowDeploymentVersion, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateId } from '@/lib/core/utils/uuid'
import {
  executeJobInline,
  executeScheduleJob,
  releaseScheduleLock,
} from '@/background/schedule-execution'

export const dynamic = 'force-dynamic'

const logger = createLogger('ScheduledExecuteAPI')

const dueFilter = (queuedAt: Date) =>
  and(
    isNull(workflowSchedule.archivedAt),
    lte(workflowSchedule.nextRunAt, queuedAt),
    not(eq(workflowSchedule.status, 'disabled')),
    ne(workflowSchedule.status, 'completed'),
    or(
      isNull(workflowSchedule.lastQueuedAt),
      lt(workflowSchedule.lastQueuedAt, workflowSchedule.nextRunAt)
    )
  )

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(request, 'Schedule execution')
  if (authError) {
    return authError
  }

  const queuedAt = new Date()

  try {
    // Workflow schedules (require active deployment)
    const dueSchedules = await db
      .update(workflowSchedule)
      .set({ lastQueuedAt: queuedAt, updatedAt: queuedAt })
      .where(
        and(
          dueFilter(queuedAt),
          or(eq(workflowSchedule.sourceType, 'workflow'), isNull(workflowSchedule.sourceType)),
          sql`${workflowSchedule.deploymentVersionId} = (select ${workflowDeploymentVersion.id} from ${workflowDeploymentVersion} where ${workflowDeploymentVersion.workflowId} = ${workflowSchedule.workflowId} and ${workflowDeploymentVersion.isActive} = true)`
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
        sourceType: workflowSchedule.sourceType,
      })

    // Jobs (no deployment, dispatch inline)
    const dueJobs = await db
      .update(workflowSchedule)
      .set({ lastQueuedAt: queuedAt, updatedAt: queuedAt })
      .where(and(dueFilter(queuedAt), eq(workflowSchedule.sourceType, 'job')))
      .returning({
        id: workflowSchedule.id,
        cronExpression: workflowSchedule.cronExpression,
        failedCount: workflowSchedule.failedCount,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
        sourceType: workflowSchedule.sourceType,
      })

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
        cronExpression: schedule.cronExpression || undefined,
        lastRanAt: schedule.lastRanAt?.toISOString(),
        failedCount: schedule.failedCount || 0,
        now: queueTime.toISOString(),
        scheduledFor: schedule.nextRunAt?.toISOString(),
      }

      try {
        const resolvedWorkflow = schedule.workflowId
          ? await workflowUtils?.getWorkflowById(schedule.workflowId)
          : null
        const resolvedWorkspaceId = resolvedWorkflow?.workspaceId

        const jobId = await jobQueue.enqueue('schedule-execution', payload, {
          metadata: {
            workflowId: schedule.workflowId ?? undefined,
            workspaceId: resolvedWorkspaceId ?? undefined,
            correlation,
          },
        })
        logger.info(
          `[${requestId}] Queued schedule execution task ${jobId} for workflow ${schedule.workflowId}`
        )

        if (shouldExecuteInline()) {
          try {
            await jobQueue.startJob(jobId)
            const output = await executeScheduleJob(payload)
            await jobQueue.completeJob(jobId, output)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
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
          error: error instanceof Error ? error.message : String(error),
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
}
