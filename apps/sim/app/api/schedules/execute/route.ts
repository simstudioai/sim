import { db, workflowDeploymentVersion, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, lt, lte, not, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { generateRequestId } from '@/lib/core/utils/request'
import { executeScheduleJob } from '@/background/schedule-execution'

export const dynamic = 'force-dynamic'

const logger = createLogger('ScheduledExecuteAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(request, 'Schedule execution')
  if (authError) {
    return authError
  }

  const queuedAt = new Date()

  try {
    const dueSchedules = await db
      .update(workflowSchedule)
      .set({
        lastQueuedAt: queuedAt,
        updatedAt: queuedAt,
      })
      .where(
        and(
          lte(workflowSchedule.nextRunAt, queuedAt),
          not(eq(workflowSchedule.status, 'disabled')),
          or(
            isNull(workflowSchedule.lastQueuedAt),
            lt(workflowSchedule.lastQueuedAt, workflowSchedule.nextRunAt)
          ),
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
      })

    logger.debug(`[${requestId}] Successfully queried schedules: ${dueSchedules.length} found`)
    logger.info(`[${requestId}] Processing ${dueSchedules.length} due scheduled workflows`)

    const jobQueue = await getJobQueue()

    const queuePromises = dueSchedules.map(async (schedule) => {
      const queueTime = schedule.lastQueuedAt ?? queuedAt

      const payload = {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        blockId: schedule.blockId || undefined,
        cronExpression: schedule.cronExpression || undefined,
        lastRanAt: schedule.lastRanAt?.toISOString(),
        failedCount: schedule.failedCount || 0,
        now: queueTime.toISOString(),
        scheduledFor: schedule.nextRunAt?.toISOString(),
      }

      try {
        const jobId = await jobQueue.enqueue('schedule-execution', payload, {
          metadata: { workflowId: schedule.workflowId },
        })
        logger.info(
          `[${requestId}] Queued schedule execution task ${jobId} for workflow ${schedule.workflowId}`
        )

        if (shouldExecuteInline()) {
          void (async () => {
            try {
              await jobQueue.startJob(jobId)
              const output = await executeScheduleJob(payload)
              await jobQueue.completeJob(jobId, output)
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              logger.error(
                `[${requestId}] Schedule execution failed for workflow ${schedule.workflowId}`,
                { jobId, error: errorMessage }
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
            }
          })()
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to queue schedule execution for workflow ${schedule.workflowId}`,
          error
        )
      }
    })

    await Promise.allSettled(queuePromises)

    logger.info(`[${requestId}] Queued ${dueSchedules.length} schedule executions`)

    return NextResponse.json({
      message: 'Scheduled workflow executions processed',
      executedCount: dueSchedules.length,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error in scheduled execution handler`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
