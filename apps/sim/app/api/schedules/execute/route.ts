import { db, workflowSchedule } from '@sim/db'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, isNull, lt, lte, not, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
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
      })

    logger.debug(`[${requestId}] Successfully queried schedules: ${dueSchedules.length} found`)
    logger.info(`[${requestId}] Processing ${dueSchedules.length} due scheduled workflows`)

    const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

    if (useTrigger) {
      const triggerPromises = dueSchedules.map(async (schedule) => {
        const queueTime = schedule.lastQueuedAt ?? queuedAt

        try {
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

          const handle = await tasks.trigger('schedule-execution', payload)
          logger.info(
            `[${requestId}] Queued schedule execution task ${handle.id} for workflow ${schedule.workflowId}`
          )
          return handle
        } catch (error) {
          logger.error(
            `[${requestId}] Failed to trigger schedule execution for workflow ${schedule.workflowId}`,
            error
          )
          return null
        }
      })

      await Promise.allSettled(triggerPromises)

      logger.info(`[${requestId}] Queued ${dueSchedules.length} schedule executions to Trigger.dev`)
    } else {
      const directExecutionPromises = dueSchedules.map(async (schedule) => {
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

        void executeScheduleJob(payload).catch((error) => {
          logger.error(
            `[${requestId}] Direct schedule execution failed for workflow ${schedule.workflowId}`,
            error
          )
        })

        logger.info(
          `[${requestId}] Queued direct schedule execution for workflow ${schedule.workflowId} (Trigger.dev disabled)`
        )
      })

      await Promise.allSettled(directExecutionPromises)

      logger.info(
        `[${requestId}] Queued ${dueSchedules.length} direct schedule executions (Trigger.dev disabled)`
      )
    }

    return NextResponse.json({
      message: 'Scheduled workflow executions processed',
      executedCount: dueSchedules.length,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error in scheduled execution handler`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
