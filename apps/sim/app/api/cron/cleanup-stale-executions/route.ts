import { asyncJobs, db } from '@sim/db'
import { tableJobs, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { JOB_RETENTION_HOURS, JOB_STATUS } from '@/lib/core/async-jobs'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('CleanupStaleExecutions')

const STALE_THRESHOLD_MS = getMaxExecutionTimeout() + 5 * 60 * 1000
const STALE_THRESHOLD_MINUTES = Math.ceil(STALE_THRESHOLD_MS / 60000)
const MAX_INT32 = 2_147_483_647
/** Terminal table-jobs older than this are pruned; only the latest job per table is ever read. */
const TABLE_JOB_RETENTION_HOURS = 24

export const GET = withRouteHandler(async (request: NextRequest) => {
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
          error: toError(error).message,
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
          status: JOB_STATUS.FAILED,
          completedAt: new Date(),
          error: `Job terminated: stuck in processing for more than ${STALE_THRESHOLD_MINUTES} minutes`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(asyncJobs.status, JOB_STATUS.PROCESSING), lt(asyncJobs.startedAt, staleThreshold))
        )
        .returning({ id: asyncJobs.id })

      asyncJobsMarkedFailed = staleAsyncJobs.length
      if (asyncJobsMarkedFailed > 0) {
        logger.info(`Marked ${asyncJobsMarkedFailed} stale async jobs as failed`)
      }
    } catch (error) {
      logger.error('Failed to clean up stale async jobs:', {
        error: toError(error).message,
      })
    }

    // Mark stale table jobs (import, export, or delete) as failed. Jobs run detached on the web container
    // and are lost if the pod is killed mid-run. `updated_at` is bumped by progress updates, so a
    // `running` job with no recent update has stalled (not merely slow). Committed work is left in
    // place (no rollback); the user retries. Also prune long-settled terminal jobs so the table
    // doesn't grow unbounded (the latest job per table is what list/detail reads surface).
    let staleTableJobsMarkedFailed = 0
    try {
      const now = new Date()
      const staleJobs = await db
        .update(tableJobs)
        .set({
          status: 'failed',
          error: `Job terminated: no progress for more than ${STALE_THRESHOLD_MINUTES} minutes (worker timeout or crash)`,
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(tableJobs.status, 'running'), lt(tableJobs.updatedAt, staleThreshold)))
        .returning({ id: tableJobs.id })

      staleTableJobsMarkedFailed = staleJobs.length
      if (staleTableJobsMarkedFailed > 0) {
        logger.info(`Marked ${staleTableJobsMarkedFailed} stale table jobs as failed`)
      }

      const terminalRetention = new Date(Date.now() - TABLE_JOB_RETENTION_HOURS * 60 * 60 * 1000)
      const pruned = await db
        .delete(tableJobs)
        .where(
          and(
            inArray(tableJobs.status, ['ready', 'failed', 'canceled']),
            lt(tableJobs.updatedAt, terminalRetention)
          )
        )
        .returning({ type: tableJobs.type, payload: tableJobs.payload })

      // Pruned export jobs carry the generated file's storage key — delete the file with the job
      // so the exports prefix doesn't accumulate. Best-effort: a miss just orphans one object.
      for (const job of pruned) {
        if (job.type !== 'export') continue
        const resultKey = (job.payload as { resultKey?: string } | null)?.resultKey
        if (!resultKey) continue
        await deleteFile({ key: resultKey, context: 'workspace' }).catch((err) => {
          logger.warn('Failed to delete pruned export file', {
            resultKey,
            error: toError(err).message,
          })
        })
      }
    } catch (error) {
      logger.error('Failed to clean up stale table jobs:', {
        error: toError(error).message,
      })
    }

    // Clean up stale pending jobs (never started, e.g., due to server crash before startJob())
    let stalePendingJobsMarkedFailed = 0

    try {
      const stalePendingJobs = await db
        .update(asyncJobs)
        .set({
          status: JOB_STATUS.FAILED,
          completedAt: new Date(),
          error: `Job terminated: stuck in pending state for more than ${STALE_THRESHOLD_MINUTES} minutes (never started)`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(asyncJobs.status, JOB_STATUS.PENDING), lt(asyncJobs.createdAt, staleThreshold))
        )
        .returning({ id: asyncJobs.id })

      stalePendingJobsMarkedFailed = stalePendingJobs.length
      if (stalePendingJobsMarkedFailed > 0) {
        logger.info(`Marked ${stalePendingJobsMarkedFailed} stale pending jobs as failed`)
      }
    } catch (error) {
      logger.error('Failed to clean up stale pending jobs:', {
        error: toError(error).message,
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
            inArray(asyncJobs.status, [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED]),
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
        error: toError(error).message,
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
        staleProcessingMarkedFailed: asyncJobsMarkedFailed,
        stalePendingMarkedFailed: stalePendingJobsMarkedFailed,
        oldDeleted: asyncJobsDeleted,
        staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
        retentionHours: JOB_RETENTION_HOURS,
      },
      tableJobs: {
        staleMarkedFailed: staleTableJobsMarkedFailed,
      },
    })
  } catch (error) {
    logger.error('Error in stale execution cleanup job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
