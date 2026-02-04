import { asyncJobs, db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { JOB_RETENTION_HOURS } from '@/lib/core/async-jobs'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'

const logger = createLogger('CleanupStaleExecutions')

const STALE_THRESHOLD_MS = getMaxExecutionTimeout() + 5 * 60 * 1000
const STALE_THRESHOLD_MINUTES = Math.ceil(STALE_THRESHOLD_MS / 60000)
const MAX_INT32 = 2_147_483_647

export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'Stale execution cleanup')
    if (authError) {
      return authError
    }

    logger.info('Starting stale execution cleanup job')

    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000)

    const staleExecutions = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        workflowId: workflowExecutionLogs.workflowId,
        startedAt: workflowExecutionLogs.startedAt,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.status, 'running'),
          lt(workflowExecutionLogs.startedAt, staleThreshold)
        )
      )
      .limit(100)

    logger.info(`Found ${staleExecutions.length} stale executions to clean up`)

    let cleaned = 0
    let failed = 0

    for (const execution of staleExecutions) {
      try {
        const staleDurationMs = Date.now() - new Date(execution.startedAt).getTime()
        const staleDurationMinutes = Math.round(staleDurationMs / 60000)
        const totalDurationMs = Math.min(staleDurationMs, MAX_INT32)

        await db
          .update(workflowExecutionLogs)
          .set({
            status: 'failed',
            endedAt: new Date(),
            totalDurationMs,
            executionData: sql`jsonb_set(
              COALESCE(execution_data, '{}'::jsonb),
              ARRAY['error'],
              to_jsonb(${`Execution terminated: worker timeout or crash after ${staleDurationMinutes} minutes`}::text)
            )`,
          })
          .where(eq(workflowExecutionLogs.id, execution.id))

        logger.info(`Cleaned up stale execution ${execution.executionId}`, {
          workflowId: execution.workflowId,
          staleDurationMinutes,
        })

        cleaned++
      } catch (error) {
        logger.error(`Failed to clean up execution ${execution.executionId}:`, {
          error: error instanceof Error ? error.message : String(error),
        })
        failed++
      }
    }

    logger.info(`Stale execution cleanup completed. Cleaned: ${cleaned}, Failed: ${failed}`)

    // Clean up stale async jobs (stuck in processing)
    let asyncJobsMarkedFailed = 0

    try {
      const staleAsyncJobs = await db
        .update(asyncJobs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          error: `Job terminated: stuck in processing for more than ${STALE_THRESHOLD_MINUTES} minutes`,
          updatedAt: new Date(),
        })
        .where(and(eq(asyncJobs.status, 'processing'), lt(asyncJobs.startedAt, staleThreshold)))
        .returning({ id: asyncJobs.id })

      asyncJobsMarkedFailed = staleAsyncJobs.length
      if (asyncJobsMarkedFailed > 0) {
        logger.info(`Marked ${asyncJobsMarkedFailed} stale async jobs as failed`)
      }
    } catch (error) {
      logger.error('Failed to clean up stale async jobs:', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Delete completed/failed jobs older than retention period
    const retentionThreshold = new Date(Date.now() - JOB_RETENTION_HOURS * 60 * 60 * 1000)
    let asyncJobsDeleted = 0

    try {
      const deletedJobs = await db
        .delete(asyncJobs)
        .where(
          and(
            inArray(asyncJobs.status, ['completed', 'failed']),
            lt(asyncJobs.completedAt, retentionThreshold)
          )
        )
        .returning({ id: asyncJobs.id })

      asyncJobsDeleted = deletedJobs.length
      if (asyncJobsDeleted > 0) {
        logger.info(
          `Deleted ${asyncJobsDeleted} old async jobs (retention: ${JOB_RETENTION_HOURS}h)`
        )
      }
    } catch (error) {
      logger.error('Failed to delete old async jobs:', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return NextResponse.json({
      success: true,
      executions: {
        found: staleExecutions.length,
        cleaned,
        failed,
        thresholdMinutes: STALE_THRESHOLD_MINUTES,
      },
      asyncJobs: {
        staleMarkedFailed: asyncJobsMarkedFailed,
        oldDeleted: asyncJobsDeleted,
        staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
        retentionHours: JOB_RETENTION_HOURS,
      },
    })
  } catch (error) {
    logger.error('Error in stale execution cleanup job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
