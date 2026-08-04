import { db } from '@sim/db'
import {
  asyncJobs,
  tableJobs,
  workflowDeploymentOperation,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, exists, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import {
  JOB_PENDING_RETENTION_HOURS,
  JOB_RETENTION_HOURS,
  JOB_STATUS,
  MAX_JOB_DURATION_SECONDS,
  MIN_JOB_DURATION_SECONDS,
} from '@/lib/core/async-jobs'
import {
  getExecutionReservationTtlMs,
  getTimeoutErrorMessage,
  RESERVATION_TTL_BUFFER_MS,
} from '@/lib/core/execution-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('CleanupStaleExecutions')

const STALE_THRESHOLD_MS = getExecutionReservationTtlMs()
const STALE_THRESHOLD_MINUTES = Math.ceil(STALE_THRESHOLD_MS / 60000)
const GENERIC_STALE_PROCESSING_ERROR = `Job terminated: stuck in processing for more than ${STALE_THRESHOLD_MINUTES} minutes`
const EXECUTION_DEADLINE_ERROR = getTimeoutErrorMessage(undefined)
const MAX_INT32 = 2_147_483_647
/**
 * Table jobs run as detached workers with progress heartbeats, independently of workflow timeout
 * policy. Preserve their historical 90-minute task window plus five-minute cleanup grace.
 */
const TABLE_JOB_STALE_THRESHOLD_MINUTES = 95
/** Terminal table-jobs older than this are pruned; only the latest job per table is ever read. */
const TABLE_JOB_RETENTION_HOURS = 24
/**
 * Terminal deployment operations older than this are pruned. Every reader of
 * this table is latest-generation-only, and idempotency keys only need to
 * survive a client retry window, so 30 days is generous.
 */
const DEPLOYMENT_OPERATION_RETENTION_DAYS = 30
const DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE = 2000
const DEPLOYMENT_OPERATION_PRUNE_MAX_BATCHES = 10
const STATE_MUTATION_BATCH_SIZE = 1000
const STATE_MUTATION_MAX_ROWS_PER_RUN = 10_000
const RETENTION_DELETE_BATCH_SIZE = 2000
const RETENTION_DELETE_MAX_ROWS_PER_RUN = 20_000
const TABLE_JOB_PRUNE_BATCH_SIZE = 100
const TABLE_JOB_PRUNE_MAX_ROWS_PER_RUN = 1000

interface BatchedMutationResult {
  affected: number
  reachedLimit: boolean
}

interface RunBatchedMutationOptions<TRow> {
  batchSize: number
  maxRowsPerRun: number
  mutation: (limit: number) => Promise<TRow[]>
  onBatch?: (rows: TRow[]) => Promise<void>
}

/**
 * Runs a mutation in bounded pages. Candidate selection happens inside each
 * mutation query, so only the bounded RETURNING rows enter application memory.
 */
async function runBatchedMutation<TRow>({
  batchSize,
  maxRowsPerRun,
  mutation,
  onBatch,
}: RunBatchedMutationOptions<TRow>): Promise<BatchedMutationResult> {
  let affected = 0

  while (affected < maxRowsPerRun) {
    const limit = Math.min(batchSize, maxRowsPerRun - affected)
    const rows = await mutation(limit)
    if (rows.length > limit) {
      throw new Error(`Cleanup mutation returned ${rows.length} rows for a ${limit}-row batch`)
    }
    if (rows.length === 0) break

    affected += rows.length
    if (onBatch) await onBatch(rows)
    if (rows.length < limit) break
  }

  return { affected, reachedLimit: affected >= maxRowsPerRun }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authError = verifyCronAuth(request, 'Stale execution cleanup')
    if (authError) {
      return authError
    }

    logger.info('Starting stale execution cleanup job')

    const now = new Date()
    const staleDeadlineThreshold = new Date(now.getTime() - RESERVATION_TTL_BUFFER_MS)
    const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MINUTES * 60 * 1000)
    const stalePendingThreshold = new Date(
      now.getTime() - JOB_PENDING_RETENTION_HOURS * 60 * 60 * 1000
    )
    const staleTableJobThreshold = new Date(
      now.getTime() - TABLE_JOB_STALE_THRESHOLD_MINUTES * 60 * 1000
    )

    const staleExecutions = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        workflowId: workflowExecutionLogs.workflowId,
        startedAt: workflowExecutionLogs.startedAt,
        executionDeadlineAt: workflowExecutionLogs.executionDeadlineAt,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.status, 'running'),
          or(
            lt(workflowExecutionLogs.executionDeadlineAt, staleDeadlineThreshold),
            and(
              isNull(workflowExecutionLogs.executionDeadlineAt),
              lt(workflowExecutionLogs.startedAt, staleThreshold)
            )
          )
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

        const [updatedExecution] = await db
          .update(workflowExecutionLogs)
          .set({
            status: 'failed',
            endedAt: new Date(),
            executionDeadlineAt: null,
            totalDurationMs,
            executionData: sql`jsonb_set(
              COALESCE(execution_data, '{}'::jsonb),
              ARRAY['error'],
              to_jsonb(
                CASE
                  WHEN ${workflowExecutionLogs.executionDeadlineAt} IS NOT NULL
                    THEN ${EXECUTION_DEADLINE_ERROR}::text
                  ELSE ${`Execution terminated: worker timeout or crash after ${staleDurationMinutes} minutes`}::text
                END
              )
            )`,
          })
          .where(
            and(
              eq(workflowExecutionLogs.id, execution.id),
              eq(workflowExecutionLogs.status, 'running'),
              or(
                lt(workflowExecutionLogs.executionDeadlineAt, staleDeadlineThreshold),
                and(
                  isNull(workflowExecutionLogs.executionDeadlineAt),
                  lt(workflowExecutionLogs.startedAt, staleThreshold)
                )
              )
            )
          )
          .returning({ id: workflowExecutionLogs.id })

        if (!updatedExecution) {
          logger.debug('Skipped stale execution whose state changed during cleanup', {
            executionId: execution.executionId,
          })
          continue
        }

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
      const hasPositiveMaxDuration = sql<boolean>`CASE
        WHEN jsonb_typeof(${asyncJobs.metadata}->'maxDurationSeconds') = 'number'
          THEN (${asyncJobs.metadata}->>'maxDurationSeconds')::numeric >= ${MIN_JOB_DURATION_SECONDS}
            AND (${asyncJobs.metadata}->>'maxDurationSeconds')::numeric <= ${MAX_JOB_DURATION_SECONDS}
            AND trunc((${asyncJobs.metadata}->>'maxDurationSeconds')::numeric)
              = (${asyncJobs.metadata}->>'maxDurationSeconds')::numeric
        ELSE FALSE
      END`
      const staleProcessingDurationPredicate = sql<boolean>`CASE
        WHEN ${hasPositiveMaxDuration}
          THEN ${asyncJobs.startedAt} + ((${asyncJobs.metadata}->>'maxDurationSeconds')::double precision * interval '1 second') < ${now}
        ELSE ${asyncJobs.startedAt} < ${staleThreshold}
      END`
      const staleProcessingPredicate = and(
        eq(asyncJobs.status, JOB_STATUS.PROCESSING),
        staleProcessingDurationPredicate
      )
      const staleProcessingResult = await runBatchedMutation({
        batchSize: STATE_MUTATION_BATCH_SIZE,
        maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        mutation: (limit) => {
          const candidates = db
            .select({ id: asyncJobs.id })
            .from(asyncJobs)
            .where(staleProcessingPredicate)
            .limit(limit)

          return db
            .update(asyncJobs)
            .set({
              status: JOB_STATUS.FAILED,
              completedAt: new Date(),
              error: sql<string>`CASE
                WHEN ${hasPositiveMaxDuration}
                  THEN 'Job terminated: stuck in processing for more than '
                    || (${asyncJobs.metadata}->>'maxDurationSeconds')
                    || ' seconds (worker cleanup deadline)'
                ELSE ${GENERIC_STALE_PROCESSING_ERROR}
              END`,
              updatedAt: new Date(),
            })
            .where(and(staleProcessingPredicate, inArray(asyncJobs.id, candidates)))
            .returning({ id: asyncJobs.id })
        },
      })

      asyncJobsMarkedFailed = staleProcessingResult.affected
      if (asyncJobsMarkedFailed > 0) {
        logger.info(`Marked ${asyncJobsMarkedFailed} stale async jobs as failed`)
      }
      if (staleProcessingResult.reachedLimit) {
        logger.info('Deferred remaining stale async jobs after reaching the per-run cap', {
          maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        })
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
      const staleTableJobPredicate = and(
        eq(tableJobs.status, 'running'),
        lt(tableJobs.updatedAt, staleTableJobThreshold)
      )
      const staleTableJobResult = await runBatchedMutation({
        batchSize: STATE_MUTATION_BATCH_SIZE,
        maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        mutation: (limit) => {
          const candidates = db
            .select({ id: tableJobs.id })
            .from(tableJobs)
            .where(staleTableJobPredicate)
            .limit(limit)

          return db
            .update(tableJobs)
            .set({
              status: 'failed',
              error: `Job terminated: no progress for more than ${TABLE_JOB_STALE_THRESHOLD_MINUTES} minutes (worker timeout or crash)`,
              completedAt: now,
              updatedAt: now,
            })
            .where(and(staleTableJobPredicate, inArray(tableJobs.id, candidates)))
            .returning({ id: tableJobs.id })
        },
      })

      staleTableJobsMarkedFailed = staleTableJobResult.affected
      if (staleTableJobsMarkedFailed > 0) {
        logger.info(`Marked ${staleTableJobsMarkedFailed} stale table jobs as failed`)
      }

      const terminalRetention = new Date(Date.now() - TABLE_JOB_RETENTION_HOURS * 60 * 60 * 1000)
      const terminalTableJobPredicate = and(
        inArray(tableJobs.status, ['ready', 'failed', 'canceled']),
        lt(tableJobs.updatedAt, terminalRetention)
      )
      const terminalTableJobResult = await runBatchedMutation({
        batchSize: TABLE_JOB_PRUNE_BATCH_SIZE,
        maxRowsPerRun: TABLE_JOB_PRUNE_MAX_ROWS_PER_RUN,
        mutation: (limit) => {
          const candidates = db
            .select({ id: tableJobs.id })
            .from(tableJobs)
            .where(terminalTableJobPredicate)
            .limit(limit)

          return db
            .delete(tableJobs)
            .where(and(terminalTableJobPredicate, inArray(tableJobs.id, candidates)))
            .returning({
              type: tableJobs.type,
              resultKey: sql<string | null>`${tableJobs.payload}->>'resultKey'`,
            })
        },
        onBatch: async (jobs) => {
          /**
           * Pruned export jobs carry the generated file's storage key. The scalar
           * key is returned instead of the full JSON payload, and cleanup stays
           * sequential so storage concurrency is bounded at one request.
           */
          for (const { type, resultKey } of jobs) {
            if (type !== 'export' || !resultKey) continue
            await deleteFile({ key: resultKey, context: 'workspace' }).catch((err) => {
              logger.warn('Failed to delete pruned export file', {
                resultKey,
                error: toError(err).message,
              })
            })
          }
        },
      })
      if (terminalTableJobResult.reachedLimit) {
        logger.info('Deferred remaining terminal table jobs after reaching the per-run cap', {
          maxRowsPerRun: TABLE_JOB_PRUNE_MAX_ROWS_PER_RUN,
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
      const stalePendingPredicate = and(
        eq(asyncJobs.status, JOB_STATUS.PENDING),
        lt(asyncJobs.createdAt, stalePendingThreshold)
      )
      const stalePendingResult = await runBatchedMutation({
        batchSize: STATE_MUTATION_BATCH_SIZE,
        maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        mutation: (limit) => {
          const candidates = db
            .select({ id: asyncJobs.id })
            .from(asyncJobs)
            .where(stalePendingPredicate)
            .limit(limit)

          return db
            .update(asyncJobs)
            .set({
              status: JOB_STATUS.FAILED,
              completedAt: new Date(),
              error: `Job terminated: stuck in pending state for more than ${JOB_PENDING_RETENTION_HOURS} hours (never started)`,
              updatedAt: new Date(),
            })
            .where(and(stalePendingPredicate, inArray(asyncJobs.id, candidates)))
            .returning({ id: asyncJobs.id })
        },
      })

      stalePendingJobsMarkedFailed = stalePendingResult.affected
      if (stalePendingJobsMarkedFailed > 0) {
        logger.info(`Marked ${stalePendingJobsMarkedFailed} stale pending jobs as failed`)
      }
      if (stalePendingResult.reachedLimit) {
        logger.info('Deferred remaining stale pending jobs after reaching the per-run cap', {
          maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        })
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
      const retainedJobPredicate = and(
        inArray(asyncJobs.status, [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED]),
        lt(asyncJobs.completedAt, retentionThreshold)
      )
      const retainedJobResult = await runBatchedMutation({
        batchSize: RETENTION_DELETE_BATCH_SIZE,
        maxRowsPerRun: RETENTION_DELETE_MAX_ROWS_PER_RUN,
        mutation: (limit) => {
          const candidates = db
            .select({ id: asyncJobs.id })
            .from(asyncJobs)
            .where(retainedJobPredicate)
            .limit(limit)

          return db
            .delete(asyncJobs)
            .where(and(retainedJobPredicate, inArray(asyncJobs.id, candidates)))
            .returning({ id: asyncJobs.id })
        },
      })

      asyncJobsDeleted = retainedJobResult.affected
      if (asyncJobsDeleted > 0) {
        logger.info(
          `Deleted ${asyncJobsDeleted} old async jobs (retention: ${JOB_RETENTION_HOURS}h)`
        )
      }
      if (retainedJobResult.reachedLimit) {
        logger.info('Deferred remaining retained async jobs after reaching the per-run cap', {
          maxRowsPerRun: RETENTION_DELETE_MAX_ROWS_PER_RUN,
        })
      }
    } catch (error) {
      logger.error('Failed to delete old async jobs:', {
        error: toError(error).message,
      })
    }

    /**
     * Prune terminal deployment operations past retention. HARD INVARIANT:
     * the newest-generation row per workflow must always survive — the next
     * deploy computes `generation = MAX(generation) + 1`, and the webhook
     * registration store fences rows with lt/gt comparisons against stored
     * generations, so generation reuse after a full wipe would permanently
     * wedge that workflow's deployments. The `exists(newer)` predicate
     * guarantees the max-generation row is never eligible; the status filter
     * keeps in-flight rows (an outbox worker may still hold their fence).
     */
    let deploymentOperationsPruned = 0
    try {
      const deploymentOpRetention = new Date(
        Date.now() - DEPLOYMENT_OPERATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
      )
      const newerOperation = alias(workflowDeploymentOperation, 'newer_operation')
      for (let batch = 0; batch < DEPLOYMENT_OPERATION_PRUNE_MAX_BATCHES; batch++) {
        const prunable = db
          .select({ id: workflowDeploymentOperation.id })
          .from(workflowDeploymentOperation)
          .where(
            and(
              inArray(workflowDeploymentOperation.status, ['active', 'failed', 'superseded']),
              lt(workflowDeploymentOperation.completedAt, deploymentOpRetention),
              exists(
                db
                  .select({ id: newerOperation.id })
                  .from(newerOperation)
                  .where(
                    and(
                      eq(newerOperation.workflowId, workflowDeploymentOperation.workflowId),
                      gt(newerOperation.generation, workflowDeploymentOperation.generation)
                    )
                  )
              )
            )
          )
          .limit(DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE)

        const deleted = await db
          .delete(workflowDeploymentOperation)
          .where(inArray(workflowDeploymentOperation.id, prunable))
          .returning({ id: workflowDeploymentOperation.id })

        deploymentOperationsPruned += deleted.length
        if (deleted.length < DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE) break
      }
      if (deploymentOperationsPruned > 0) {
        logger.info(
          `Pruned ${deploymentOperationsPruned} old deployment operations (retention: ${DEPLOYMENT_OPERATION_RETENTION_DAYS}d)`
        )
      }
    } catch (error) {
      logger.error('Failed to prune old deployment operations:', {
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
      deploymentOperations: {
        pruned: deploymentOperationsPruned,
        retentionDays: DEPLOYMENT_OPERATION_RETENTION_DAYS,
      },
    })
  } catch (error) {
    logger.error('Error in stale execution cleanup job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
