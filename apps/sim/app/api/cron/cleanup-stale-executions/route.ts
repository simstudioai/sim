import { db } from '@sim/db'
import {
  asyncJobs,
  knowledgeConnectorSyncLog,
  tableJobs,
  workflowDeploymentOperation,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, exists, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import {
  JOB_PENDING_RETENTION_HOURS,
  JOB_RETENTION_HOURS,
  JOB_STATUS,
  MAX_JOB_DURATION_SECONDS,
  MIN_JOB_DURATION_SECONDS,
  TERMINAL_JOB_STATUSES,
} from '@/lib/core/async-jobs'
import {
  getExecutionReservationTtlMs,
  getTimeoutErrorMessage,
  RESERVATION_TTL_BUFFER_MS,
} from '@/lib/core/execution-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { DbTransaction } from '@/lib/db/types'
import { elapsedDurationMsSql } from '@/lib/logs/execution/duration'
import {
  STALE_SWEEPABLE_EXECUTION_STATUSES,
  type StaleSweepableExecutionStatus,
} from '@/lib/logs/types'
import { cancelStaleDispatches } from '@/lib/table/dispatcher'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import {
  carrierNotIrrecoverableSql,
  carrierReconciledSql,
  SCHEDULE_CARRIER_IRRECOVERABLE_RETENTION_HOURS,
} from '@/lib/workflows/schedules/carrier-metadata'
import { SCHEDULE_EXECUTION_QUEUE_NAME } from '@/lib/workflows/schedules/execution-limits'

const logger = createLogger('CleanupStaleExecutions')

const STALE_THRESHOLD_MS = getExecutionReservationTtlMs()
const STALE_THRESHOLD_MINUTES = Math.ceil(STALE_THRESHOLD_MS / 60000)
const GENERIC_STALE_PROCESSING_ERROR = `Job terminated: stuck in processing for more than ${STALE_THRESHOLD_MINUTES} minutes`
const EXECUTION_DEADLINE_ERROR = getTimeoutErrorMessage(undefined)
/**
 * Table jobs run as detached workers with progress heartbeats, independently of workflow timeout
 * policy. Preserve their historical 90-minute task window plus five-minute cleanup grace.
 */
const TABLE_JOB_STALE_THRESHOLD_MINUTES = 95
/** Terminal table-jobs older than this are pruned; only the latest job per table is ever read. */
const TABLE_JOB_RETENTION_HOURS = 24
/**
 * A table run dispatch whose holder has not made progress for this long is
 * treated as dead. Same shape and window as the table-job threshold above: the
 * 90-minute Trigger.dev task ceiling (`maxDuration` in `trigger.config.ts`) plus
 * five minutes of cleanup grace, measured from the dispatcher's own per-window
 * heartbeat rather than from when the run was requested.
 */
const TABLE_DISPATCH_STALE_THRESHOLD_MINUTES = 95
/** Per-run ceiling on reaped dispatches, so one tick cannot fan out unbounded SSE. */
const TABLE_DISPATCH_MAX_PER_RUN = 200
/**
 * Terminal deployment operations older than this are pruned. Every reader of
 * this table is latest-generation-only, and idempotency keys only need to
 * survive a client retry window, so 30 days is generous.
 */
const DEPLOYMENT_OPERATION_RETENTION_DAYS = 30
/**
 * Terminal connector sync logs older than this are pruned. Nothing pruned them
 * before, so the table grew by one row per sync run forever — a connector on a
 * fifteen-minute interval writes about 35,000 rows a year on its own. That cost
 * lands on `loadPreviousListingObservation`, which reads the newest `completed`
 * row per connector through an index covering `connector_id` alone, so every
 * retained row makes the sort behind the deletion-safety corroboration slower.
 */
const CONNECTOR_SYNC_LOG_RETENTION_DAYS = 30
const CONNECTOR_SYNC_LOG_PRUNE_BATCH_SIZE = 2000
const CONNECTOR_SYNC_LOG_MAX_ROWS_PER_RUN = 20_000
const DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE = 2000
const DEPLOYMENT_OPERATION_PRUNE_MAX_BATCHES = 10
const WORKFLOW_EXECUTION_MUTATION_BATCH_SIZE = 100
const WORKFLOW_EXECUTION_MAX_ROWS_PER_RUN = 1000
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

interface RunBatchedMutationOptions<TCandidate extends { id: string }, TRow> {
  batchSize: number
  maxRowsPerRun: number
  claim: (tx: DbTransaction, limit: number) => Promise<TCandidate[]>
  mutation: (tx: DbTransaction, candidateIds: string[]) => Promise<TRow[]>
  onBatch?: (rows: TRow[]) => Promise<void>
}

/**
 * Runs a mutation in bounded, atomic pages. Each page claims explicit rows with
 * `FOR UPDATE SKIP LOCKED` and mutates those same rows before committing, so
 * concurrent cleanup workers cannot overlap and `LIMIT` is evaluated exactly once.
 */
async function runBatchedMutation<TCandidate extends { id: string }, TRow>({
  batchSize,
  maxRowsPerRun,
  claim,
  mutation,
  onBatch,
}: RunBatchedMutationOptions<TCandidate, TRow>): Promise<BatchedMutationResult> {
  let affected = 0

  while (affected < maxRowsPerRun) {
    const limit = Math.min(batchSize, maxRowsPerRun - affected)
    const { candidates, rows } = await db.transaction(async (tx) => {
      const candidates = await claim(tx, limit)
      if (candidates.length > limit) {
        throw new Error(`Cleanup claimed ${candidates.length} rows for a ${limit}-row batch`)
      }
      if (candidates.length === 0) return { candidates, rows: [] as TRow[] }

      const rows = await mutation(
        tx,
        candidates.map(({ id }) => id)
      )
      if (rows.length !== candidates.length) {
        throw new Error(
          `Cleanup mutation returned ${rows.length} rows for ${candidates.length} claimed rows`
        )
      }
      return { candidates, rows }
    })
    if (candidates.length === 0) break

    affected += rows.length
    if (onBatch) await onBatch(rows)
    if (candidates.length < limit) break
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
    const staleDispatchThreshold = new Date(
      now.getTime() - TABLE_DISPATCH_STALE_THRESHOLD_MINUTES * 60 * 1000
    )

    let staleExecutionsFound = 0
    let cleaned = 0
    let failed = 0
    let currentWorkflowBatchSize = 0

    try {
      /**
       * `running` is swept on its execution deadline plus the cleanup grace, or
       * on the generic stale window when it has no deadline.
       *
       * `redacting` gets the generic window only. That status is set *after* the
       * run finished, while a live worker masks the payload, so the execution
       * deadline is already in the past by the time redaction starts — the
       * deadline rule would fail a masking pass that is merely slow, and
       * schedule recovery would read that as a failed occurrence even though
       * the worker is about to persist `completed`. A redaction that genuinely
       * crashed still clears within the generic window.
       */
      const staleExecutionTimePredicate = (status: StaleSweepableExecutionStatus) =>
        status === 'redacting'
          ? lt(workflowExecutionLogs.startedAt, staleThreshold)
          : or(
              lt(workflowExecutionLogs.executionDeadlineAt, staleDeadlineThreshold),
              and(
                isNull(workflowExecutionLogs.executionDeadlineAt),
                lt(workflowExecutionLogs.startedAt, staleThreshold)
              )
            )
      const cleanupTimestamp = sql.param(now, workflowExecutionLogs.startedAt)
      const staleDurationMinutes = sql<number>`ROUND(
        EXTRACT(EPOCH FROM (${cleanupTimestamp} - ${workflowExecutionLogs.startedAt})) / 60
      )::integer`
      const totalDurationMs = elapsedDurationMsSql(now)
      const staleDurationError = sql`${'Execution terminated: worker timeout or crash after '}::text
        || ${staleDurationMinutes}::text
        || ' minutes'`
      /**
       * A `redacting` row is never swept by the deadline rule, so the deadline
       * message cannot apply to it.
       */
      const staleExecutionError = (status: StaleSweepableExecutionStatus) =>
        status === 'redacting'
          ? staleDurationError
          : sql`CASE
              WHEN ${workflowExecutionLogs.executionDeadlineAt} IS NOT NULL
                THEN ${EXECUTION_DEADLINE_ERROR}::text
              ELSE ${staleDurationError}
            END`
      /**
       * Swept one status at a time so each pass stays on its own partial index;
       * `status IN (...)` would match neither. The row budget is shared across
       * both passes so the per-run cap keeps meaning what its name says.
       */
      let workflowRowsConsidered = 0
      for (const executionStatus of STALE_SWEEPABLE_EXECUTION_STATUSES) {
        const staleExecutionPredicate = and(
          eq(workflowExecutionLogs.status, executionStatus),
          staleExecutionTimePredicate(executionStatus)
        )
        while (workflowRowsConsidered < WORKFLOW_EXECUTION_MAX_ROWS_PER_RUN) {
          const limit = Math.min(
            WORKFLOW_EXECUTION_MUTATION_BATCH_SIZE,
            WORKFLOW_EXECUTION_MAX_ROWS_PER_RUN - workflowRowsConsidered
          )
          currentWorkflowBatchSize = 0
          const { candidates, updatedExecutions } = await db.transaction(async (tx) => {
            const candidates = await tx
              .select({ id: workflowExecutionLogs.id })
              .from(workflowExecutionLogs)
              .where(staleExecutionPredicate)
              .limit(limit)
              .for('update', { skipLocked: true })
            currentWorkflowBatchSize = candidates.length
            if (candidates.length === 0) return { candidates, updatedExecutions: [] }

            const updatedExecutions = await tx
              .update(workflowExecutionLogs)
              .set({
                status: 'failed',
                endedAt: now,
                executionDeadlineAt: null,
                totalDurationMs,
                executionData: sql`jsonb_set(
                  COALESCE(execution_data, '{}'::jsonb),
                  ARRAY['error'],
                  to_jsonb(${staleExecutionError(executionStatus)})
                )`,
              })
              .where(
                and(
                  staleExecutionPredicate,
                  inArray(
                    workflowExecutionLogs.id,
                    candidates.map(({ id }) => id)
                  )
                )
              )
              .returning({ id: workflowExecutionLogs.id })

            return { candidates, updatedExecutions }
          })
          currentWorkflowBatchSize = 0
          staleExecutionsFound += candidates.length
          if (candidates.length === 0) break

          cleaned += updatedExecutions.length
          workflowRowsConsidered += candidates.length
          if (candidates.length < limit) break
        }
      }

      if (workflowRowsConsidered >= WORKFLOW_EXECUTION_MAX_ROWS_PER_RUN) {
        logger.info('Deferred remaining stale workflow executions after reaching the per-run cap', {
          maxRowsPerRun: WORKFLOW_EXECUTION_MAX_ROWS_PER_RUN,
        })
      }
    } catch (error) {
      logger.error('Failed to clean up stale workflow executions:', {
        error: toError(error).message,
      })
      staleExecutionsFound += currentWorkflowBatchSize
      failed += currentWorkflowBatchSize
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
      // A bare `Date` in a raw template reaches the driver unserialized; `sql.param`
      // binds it through the column encoder, as `lt(column, date)` does elsewhere here.
      const staleProcessingCutoff = sql.param(now, asyncJobs.startedAt)
      const staleProcessingFallbackCutoff = sql.param(staleThreshold, asyncJobs.startedAt)
      const staleProcessingDurationPredicate = sql<boolean>`CASE
        WHEN ${hasPositiveMaxDuration}
          THEN ${asyncJobs.startedAt} + ((${asyncJobs.metadata}->>'maxDurationSeconds')::double precision * interval '1 second') < ${staleProcessingCutoff}
        ELSE ${asyncJobs.startedAt} < ${staleProcessingFallbackCutoff}
      END`
      const staleProcessingPredicate = and(
        eq(asyncJobs.status, JOB_STATUS.PROCESSING),
        ne(asyncJobs.type, SCHEDULE_EXECUTION_QUEUE_NAME),
        staleProcessingDurationPredicate
      )
      const staleProcessingResult = await runBatchedMutation({
        batchSize: STATE_MUTATION_BATCH_SIZE,
        maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        claim: (tx, limit) =>
          tx
            .select({ id: asyncJobs.id })
            .from(asyncJobs)
            .where(staleProcessingPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
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
            .where(and(staleProcessingPredicate, inArray(asyncJobs.id, candidateIds)))
            .returning({ id: asyncJobs.id }),
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
        claim: (tx, limit) =>
          tx
            .select({ id: tableJobs.id })
            .from(tableJobs)
            .where(staleTableJobPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
            .update(tableJobs)
            .set({
              status: 'failed',
              error: `Job terminated: no progress for more than ${TABLE_JOB_STALE_THRESHOLD_MINUTES} minutes (worker timeout or crash)`,
              completedAt: now,
              updatedAt: now,
            })
            .where(and(staleTableJobPredicate, inArray(tableJobs.id, candidateIds)))
            .returning({ id: tableJobs.id }),
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
        claim: (tx, limit) =>
          tx
            .select({ id: tableJobs.id })
            .from(tableJobs)
            .where(terminalTableJobPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
            .delete(tableJobs)
            .where(and(terminalTableJobPredicate, inArray(tableJobs.id, candidateIds)))
            .returning({
              type: tableJobs.type,
              resultKey: sql<string | null>`${tableJobs.payload}->>'resultKey'`,
            }),
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
        ne(asyncJobs.type, SCHEDULE_EXECUTION_QUEUE_NAME),
        lt(asyncJobs.createdAt, stalePendingThreshold)
      )
      const stalePendingResult = await runBatchedMutation({
        batchSize: STATE_MUTATION_BATCH_SIZE,
        maxRowsPerRun: STATE_MUTATION_MAX_ROWS_PER_RUN,
        claim: (tx, limit) =>
          tx
            .select({ id: asyncJobs.id })
            .from(asyncJobs)
            .where(stalePendingPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
            .update(asyncJobs)
            .set({
              status: JOB_STATUS.FAILED,
              completedAt: new Date(),
              error: `Job terminated: stuck in pending state for more than ${JOB_PENDING_RETENTION_HOURS} hours (never started)`,
              updatedAt: new Date(),
            })
            .where(and(stalePendingPredicate, inArray(asyncJobs.id, candidateIds)))
            .returning({ id: asyncJobs.id }),
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

    const retentionThreshold = new Date(Date.now() - JOB_RETENTION_HOURS * 60 * 60 * 1000)
    const irrecoverableCarrierRetentionThreshold = new Date(
      Date.now() - SCHEDULE_CARRIER_IRRECOVERABLE_RETENTION_HOURS * 60 * 60 * 1000
    )
    let asyncJobsDeleted = 0

    try {
      const retainedJobPredicate = and(
        inArray(asyncJobs.status, TERMINAL_JOB_STATUSES),
        or(
          ne(asyncJobs.type, SCHEDULE_EXECUTION_QUEUE_NAME),
          /**
           * Schedule recovery owns a carrier until it stamps the reconciled
           * marker, so retention waits for it rather than deleting an
           * occurrence that has not been accounted for yet.
           */
          and(
            carrierReconciledSql(asyncJobs.metadata),
            or(
              carrierNotIrrecoverableSql(asyncJobs.metadata),
              lt(asyncJobs.completedAt, irrecoverableCarrierRetentionThreshold)
            )
          )
        ),
        lt(asyncJobs.completedAt, retentionThreshold)
      )
      const retainedJobResult = await runBatchedMutation({
        batchSize: RETENTION_DELETE_BATCH_SIZE,
        maxRowsPerRun: RETENTION_DELETE_MAX_ROWS_PER_RUN,
        claim: (tx, limit) =>
          tx
            .select({ id: asyncJobs.id })
            .from(asyncJobs)
            .where(retainedJobPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
            .delete(asyncJobs)
            .where(and(retainedJobPredicate, inArray(asyncJobs.id, candidateIds)))
            .returning({ id: asyncJobs.id }),
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
     * Prune terminal connector sync logs past retention.
     *
     * HARD INVARIANT: the newest row per connector must survive, and so must the
     * newest `completed` row. `loadPreviousListingObservation` reconstructs the
     * previous listing from the latest `completed` log, and that reconstruction
     * decides whether a suspect listing is corroborated — i.e. whether
     * reconciliation may delete documents. Pruning the last `completed` row
     * would silently change deletion behaviour, so both `exists` guards below
     * are load-bearing rather than defensive.
     *
     * `started` rows are never eligible: they are either in flight or waiting on
     * the scheduler's own sweep to close them.
     */
    let connectorSyncLogsPruned = 0
    try {
      const syncLogRetention = new Date(
        Date.now() - CONNECTOR_SYNC_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
      )
      const newerSyncLog = alias(knowledgeConnectorSyncLog, 'newer_sync_log')
      const newerCompletedSyncLog = alias(knowledgeConnectorSyncLog, 'newer_completed_sync_log')
      const syncLogPredicate = and(
        inArray(knowledgeConnectorSyncLog.status, ['completed', 'failed']),
        lt(knowledgeConnectorSyncLog.startedAt, syncLogRetention),
        exists(
          db
            .select({ id: newerSyncLog.id })
            .from(newerSyncLog)
            .where(
              and(
                eq(newerSyncLog.connectorId, knowledgeConnectorSyncLog.connectorId),
                gt(newerSyncLog.startedAt, knowledgeConnectorSyncLog.startedAt)
              )
            )
        ),
        or(
          ne(knowledgeConnectorSyncLog.status, 'completed'),
          exists(
            db
              .select({ id: newerCompletedSyncLog.id })
              .from(newerCompletedSyncLog)
              .where(
                and(
                  eq(newerCompletedSyncLog.connectorId, knowledgeConnectorSyncLog.connectorId),
                  eq(newerCompletedSyncLog.status, 'completed'),
                  gt(newerCompletedSyncLog.startedAt, knowledgeConnectorSyncLog.startedAt)
                )
              )
          )
        )
      )
      const syncLogResult = await runBatchedMutation({
        batchSize: CONNECTOR_SYNC_LOG_PRUNE_BATCH_SIZE,
        maxRowsPerRun: CONNECTOR_SYNC_LOG_MAX_ROWS_PER_RUN,
        claim: (tx, limit) =>
          tx
            .select({ id: knowledgeConnectorSyncLog.id })
            .from(knowledgeConnectorSyncLog)
            .where(syncLogPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
            .delete(knowledgeConnectorSyncLog)
            .where(inArray(knowledgeConnectorSyncLog.id, candidateIds))
            .returning({ id: knowledgeConnectorSyncLog.id }),
      })
      connectorSyncLogsPruned = syncLogResult.affected
      if (connectorSyncLogsPruned > 0) {
        logger.info(
          `Pruned ${connectorSyncLogsPruned} old connector sync logs (retention: ${CONNECTOR_SYNC_LOG_RETENTION_DAYS}d)`
        )
      }
      if (syncLogResult.reachedLimit) {
        logger.info('Deferred remaining connector sync logs after reaching the per-run cap', {
          maxRowsPerRun: CONNECTOR_SYNC_LOG_MAX_ROWS_PER_RUN,
        })
      }
    } catch (error) {
      logger.error('Failed to prune old connector sync logs:', {
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
      const deploymentOpPredicate = and(
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
      const deploymentOpResult = await runBatchedMutation({
        batchSize: DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE,
        maxRowsPerRun:
          DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE * DEPLOYMENT_OPERATION_PRUNE_MAX_BATCHES,
        claim: (tx, limit) =>
          tx
            .select({ id: workflowDeploymentOperation.id })
            .from(workflowDeploymentOperation)
            .where(deploymentOpPredicate)
            .limit(limit)
            .for('update', { skipLocked: true }),
        mutation: (tx, candidateIds) =>
          tx
            .delete(workflowDeploymentOperation)
            .where(inArray(workflowDeploymentOperation.id, candidateIds))
            .returning({ id: workflowDeploymentOperation.id }),
      })
      deploymentOperationsPruned = deploymentOpResult.affected
      if (deploymentOperationsPruned > 0) {
        logger.info(
          `Pruned ${deploymentOperationsPruned} old deployment operations (retention: ${DEPLOYMENT_OPERATION_RETENTION_DAYS}d)`
        )
      }
      if (deploymentOpResult.reachedLimit) {
        logger.info('Deferred remaining deployment operations after reaching the per-run cap', {
          maxRowsPerRun:
            DEPLOYMENT_OPERATION_PRUNE_BATCH_SIZE * DEPLOYMENT_OPERATION_PRUNE_MAX_BATCHES,
        })
      }
    } catch (error) {
      logger.error('Failed to prune old deployment operations:', {
        error: toError(error).message,
      })
    }

    /**
     * Cancel table run dispatches abandoned by a dead dispatcher. Nothing else
     * reclaims them — every other terminal transition is user- or flow-initiated
     * — so a dispatcher killed mid-loop left the row `dispatching` forever and
     * the client's "X running" overlay with it. Ages from the dispatcher's
     * per-window heartbeat, so a slow-but-live dispatch is spared.
     */
    let staleDispatchesCancelled = 0
    try {
      staleDispatchesCancelled = (
        await cancelStaleDispatches(staleDispatchThreshold, TABLE_DISPATCH_MAX_PER_RUN)
      ).length
      if (staleDispatchesCancelled > 0) {
        logger.warn(`Cancelled ${staleDispatchesCancelled} abandoned table run dispatches`, {
          thresholdMinutes: TABLE_DISPATCH_STALE_THRESHOLD_MINUTES,
        })
      }
    } catch (error) {
      logger.error('Failed to cancel abandoned table run dispatches:', {
        error: toError(error).message,
      })
    }

    return NextResponse.json({
      success: true,
      executions: {
        found: staleExecutionsFound,
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
      connectorSyncLogs: {
        pruned: connectorSyncLogsPruned,
        retentionDays: CONNECTOR_SYNC_LOG_RETENTION_DAYS,
      },
      tableRunDispatches: {
        staleCancelled: staleDispatchesCancelled,
        thresholdMinutes: TABLE_DISPATCH_STALE_THRESHOLD_MINUTES,
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
