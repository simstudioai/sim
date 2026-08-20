import {
  asyncJobs,
  db,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowSchedule,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { randomInt } from '@sim/utils/random'
import { Cron } from 'croner'
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExecuteSchedulesResponse } from '@/lib/api/contracts/schedules'
import { verifyCronAuth } from '@/lib/auth/internal'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  getJobQueue,
  JOB_PENDING_RETENTION_HOURS,
  shouldExecuteInline,
} from '@/lib/core/async-jobs'
import {
  isAsyncJobEnqueueError,
  JOB_STATUS,
  type Job,
  TERMINAL_JOB_STATUSES,
} from '@/lib/core/async-jobs/types'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import {
  getExecutionReservationTtlMs,
  getExecutionTimeout,
  RESERVATION_TTL_BUFFER_MS,
  toTriggerMaxDurationSeconds,
} from '@/lib/core/execution-limits'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { DbOrTx } from '@/lib/db/types'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import {
  buildCarrierReconciledMetadata,
  carrierNotReconciledSql,
} from '@/lib/workflows/schedules/carrier-metadata'
import { notifyScheduleAutoDisabled } from '@/lib/workflows/schedules/disable-notifications'
import {
  SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  SCHEDULE_EXECUTION_QUEUE_NAME,
  SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS,
  SCHEDULE_JITTER_MAX_MS,
  SCHEDULE_WORKFLOW_ENQUEUE_LIMIT,
} from '@/lib/workflows/schedules/execution-limits'
import { calculateScheduleInfraRetryDelayMs } from '@/lib/workflows/schedules/retry'
import {
  applyScheduleCancellationUpdate,
  applyScheduleFailureUpdate,
  applyScheduleSuccessUpdate,
  executeScheduleJob,
  releaseScheduleLock,
  type ScheduleExecutionPayload,
} from '@/background/schedule-execution'

export const dynamic = 'force-dynamic'
export const maxDuration = 3600

const logger = createLogger('ScheduledExecuteAPI')
const WORKFLOW_CHUNK_SIZE = 100
/**
 * Recovery sweeps a batch of up to `STALE_SCHEDULE_RECOVERY_BATCH_SIZE` schedules,
 * each fanning out to every workspace admin. Cap the mail so one tick can't turn
 * into hundreds of inline sends; the remainder is logged.
 */
const STALE_SCHEDULE_RECOVERY_NOTIFY_LIMIT = 25
const MAX_TICK_DURATION_MS = 3 * 60 * 1000
const STALE_SCHEDULE_CLAIM_MS = getExecutionReservationTtlMs()
const STALE_SCHEDULE_RECOVERY_BATCH_SIZE = 100
const DATABASE_SCHEDULE_START_TURN_WAIT_MS = 1_000
type DatabaseScheduleStartResult = 'started' | 'capacity_full' | 'not_pending'
let databaseScheduleStartTurn: Promise<void> | null = null

const dueFilter = (queuedAt: Date) =>
  and(
    isNull(workflowSchedule.archivedAt),
    lte(workflowSchedule.nextRunAt, queuedAt),
    sql`${workflowSchedule.status} NOT IN ('disabled', 'completed')`,
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
    sql`(${workflowSchedule.sourceType} = 'workflow' OR ${workflowSchedule.sourceType} IS NULL)`,
    activeWorkflowDeploymentFilter()
  )

async function runWithDatabaseScheduleStartTurn(
  operation: () => Promise<DatabaseScheduleStartResult>
): Promise<DatabaseScheduleStartResult> {
  const activeTurn = databaseScheduleStartTurn
  if (activeTurn) {
    const turnOpened = await Promise.race([
      activeTurn.then(() => true),
      sleep(DATABASE_SCHEDULE_START_TURN_WAIT_MS).then(() => false),
    ])
    if (!turnOpened || databaseScheduleStartTurn) return 'capacity_full'
  }

  let releaseTurn = () => {}
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  databaseScheduleStartTurn = currentTurn

  try {
    return await operation()
  } finally {
    if (databaseScheduleStartTurn === currentTurn) {
      databaseScheduleStartTurn = null
    }
    releaseTurn()
  }
}

function buildScheduleExecutionJobId(schedule: {
  id: string
  nextRunAt?: Date | null
  lastQueuedAt?: Date | null
}): string {
  const occurrence =
    schedule.nextRunAt?.toISOString() ?? schedule.lastQueuedAt?.toISOString() ?? 'due'
  return `schedule_${sha256Hex(`${schedule.id}:${occurrence}`).slice(0, 32)}`
}

function getNextRunFromCronExpression(
  cronExpression?: string | null,
  timezone = 'UTC'
): Date | null {
  if (!cronExpression) return null
  const cron = new Cron(cronExpression, { timezone })
  return cron.nextRun()
}

async function claimWorkflowSchedules(queuedAt: Date, limit: number) {
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

type ClaimedSchedule = Awaited<ReturnType<typeof claimWorkflowSchedules>>[number]
type JobQueue = Awaited<ReturnType<typeof getJobQueue>>
type DatabaseScheduleExecutionTarget = Pick<
  ClaimedSchedule,
  'id' | 'workflowId' | 'cronExpression' | 'timezone'
>
type ScheduleRecoveryMetadata = Pick<
  ScheduleExecutionPayload,
  | 'scheduleId'
  | 'workflowId'
  | 'now'
  | 'cronExpression'
  | 'timezone'
  | 'executionTimeoutMs'
  | 'executionId'
  | 'scheduledFor'
>
type ScheduleRecoveryOutcome = 'success' | 'paused' | 'failure' | 'cancelled' | 'indeterminate'
type ScheduleRecoveryEvidence = {
  outcome: ScheduleRecoveryOutcome
  executionStatus: string | null
  logFound: boolean
}
type SchedulePayloadValidation =
  | { success: true; payload: ScheduleExecutionPayload }
  | { success: false; error: string }

function getScheduleRecoveryMetadataFromValue(payload: unknown): ScheduleRecoveryMetadata | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Record<string, unknown>
  if (
    typeof candidate.scheduleId !== 'string' ||
    typeof candidate.workflowId !== 'string' ||
    typeof candidate.now !== 'string'
  ) {
    return null
  }

  return {
    scheduleId: candidate.scheduleId,
    workflowId: candidate.workflowId,
    now: candidate.now,
    executionId:
      typeof candidate.executionId === 'string' && candidate.executionId.length > 0
        ? candidate.executionId
        : undefined,
    cronExpression:
      typeof candidate.cronExpression === 'string' ? candidate.cronExpression : undefined,
    timezone: typeof candidate.timezone === 'string' ? candidate.timezone : undefined,
    executionTimeoutMs:
      typeof candidate.executionTimeoutMs === 'number' &&
      Number.isFinite(candidate.executionTimeoutMs) &&
      candidate.executionTimeoutMs > 0
        ? candidate.executionTimeoutMs
        : undefined,
    scheduledFor: typeof candidate.scheduledFor === 'string' ? candidate.scheduledFor : undefined,
  }
}

function getScheduleRecoveryMetadataFromJob(job: Job): ScheduleRecoveryMetadata | null {
  return getScheduleRecoveryMetadataFromValue(job.payload)
}

function getSchedulePayloadValidation(payload: unknown): SchedulePayloadValidation {
  const metadata = getScheduleRecoveryMetadataFromValue(payload)
  if (!metadata || !payload || typeof payload !== 'object') {
    return { success: false, error: 'recovery metadata is invalid' }
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.workspaceId !== 'string' || candidate.workspaceId.length === 0) {
    return { success: false, error: 'workspaceId is required' }
  }
  if (candidate.billingAttribution === undefined || candidate.billingAttribution === null) {
    return { success: false, error: 'billingAttribution is required' }
  }

  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution = assertBillingAttributionSnapshot(candidate.billingAttribution)
  } catch (error) {
    return { success: false, error: toError(error).message }
  }

  if (billingAttribution.workspaceId !== candidate.workspaceId) {
    return {
      success: false,
      error: 'billing attribution workspace does not match payload workspace',
    }
  }
  if (billingAttribution.actorUserId !== billingAttribution.billedAccountUserId) {
    return {
      success: false,
      error: 'billing attribution actor does not match billed account',
    }
  }

  return {
    success: true,
    payload: {
      ...metadata,
      workspaceId: candidate.workspaceId,
      billingAttribution,
      executionId: typeof candidate.executionId === 'string' ? candidate.executionId : undefined,
      requestId: typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
      blockId: typeof candidate.blockId === 'string' ? candidate.blockId : undefined,
      deploymentVersionId:
        typeof candidate.deploymentVersionId === 'string'
          ? candidate.deploymentVersionId
          : undefined,
      deploymentOperationId:
        typeof candidate.deploymentOperationId === 'string'
          ? candidate.deploymentOperationId
          : undefined,
      lastRanAt: typeof candidate.lastRanAt === 'string' ? candidate.lastRanAt : undefined,
      failedCount: typeof candidate.failedCount === 'number' ? candidate.failedCount : undefined,
      infraRetryCount:
        typeof candidate.infraRetryCount === 'number' ? candidate.infraRetryCount : undefined,
      scheduledFor: typeof candidate.scheduledFor === 'string' ? candidate.scheduledFor : undefined,
    },
  }
}

function getSchedulePayloadClaimedAt(payload: ScheduleRecoveryMetadata | null): Date | null {
  if (!payload) return null
  const claimedAt = new Date(payload.now)
  return Number.isNaN(claimedAt.getTime()) ? null : claimedAt
}

async function restoreScheduleClaim(
  scheduleId: string,
  requestId: string,
  currentClaim: Date,
  activeClaim: Date,
  context: string
): Promise<boolean> {
  if (currentClaim.getTime() === activeClaim.getTime()) return true

  const [restored] = await db
    .update(workflowSchedule)
    .set({ lastQueuedAt: activeClaim, updatedAt: new Date() })
    .where(
      and(
        eq(workflowSchedule.id, scheduleId),
        isNull(workflowSchedule.archivedAt),
        eq(workflowSchedule.lastQueuedAt, currentClaim)
      )
    )
    .returning({ id: workflowSchedule.id })
    .catch((error) => {
      logger.error(`[${requestId}] ${context}`, error)
      throw error
    })

  if (!restored) {
    logger.warn(`[${requestId}] ${context}`, {
      scheduleId,
      currentClaim: currentClaim.toISOString(),
      activeClaim: activeClaim.toISOString(),
    })
    return false
  }

  return true
}

function getScheduleExecutionLeaseMs(
  source?: {
    metadata?: unknown
    payload?: unknown
  } | null
): number {
  if (isRecordLike(source?.metadata)) {
    const maxDurationSeconds = source.metadata.maxDurationSeconds
    if (
      typeof maxDurationSeconds === 'number' &&
      Number.isFinite(maxDurationSeconds) &&
      maxDurationSeconds > 0
    ) {
      return maxDurationSeconds * 1000
    }
  }

  const payload = getScheduleRecoveryMetadataFromValue(source?.payload)
  if (payload?.executionTimeoutMs) {
    return payload.executionTimeoutMs + RESERVATION_TTL_BUFFER_MS
  }

  return STALE_SCHEDULE_CLAIM_MS
}

function isStaleScheduleClaim(
  claimedAt: Date,
  source?: { metadata?: unknown; payload?: unknown; startedAt?: Date } | null
): boolean {
  if (source?.startedAt) {
    return source.startedAt.getTime() + getScheduleExecutionLeaseMs(source) <= Date.now()
  }

  const pendingRetentionMs = JOB_PENDING_RETENTION_HOURS * 60 * 60 * 1000
  return claimedAt.getTime() + pendingRetentionMs <= Date.now()
}

function activeScheduleExecutionJobsFilter() {
  return sql`${asyncJobs.type} = 'schedule-execution' AND ${asyncJobs.status} = 'processing'`
}

/**
 * Due pending carriers, split by whether a worker has already claimed the
 * occurrence. Untouched carriers (`attempts = 0`) are the only ones still safe
 * to execute; claimed ones are reconciled from their persisted execution log.
 */
function pendingScheduleExecutionJobsFilter(now: Date, options: { claimed?: boolean } = {}) {
  return and(
    sql`${asyncJobs.type} = 'schedule-execution' AND ${asyncJobs.status} = 'pending'`,
    options.claimed ? gt(asyncJobs.attempts, 0) : eq(asyncJobs.attempts, 0),
    or(isNull(asyncJobs.runAt), lte(asyncJobs.runAt, now))
  )
}

const TERMINAL_JOB_STATUS_SQL_LIST = sql.raw(
  TERMINAL_JOB_STATUSES.map((status) => `'${status}'`).join(', ')
)

/**
 * Terminal carriers whose schedule accounting has not been replayed yet.
 * Schedule recovery owns these rows until the reconciled marker is stamped,
 * which is also what releases them to async-job retention.
 *
 * Written entirely with SQL literals so it matches the partial index
 * `async_jobs_schedule_unreconciled_terminal_idx` verbatim — a bound status
 * list or metadata key defeats predicate implication and seq-scans the table.
 */
function unreconciledTerminalScheduleExecutionJobsFilter() {
  return and(
    sql`${asyncJobs.type} = 'schedule-execution'`,
    sql`${asyncJobs.status} IN (${TERMINAL_JOB_STATUS_SQL_LIST})`,
    carrierNotReconciledSql(asyncJobs.metadata)
  )
}

function staleScheduleExecutionJobsFilter(now: Date) {
  const legacyMaxDurationSeconds = STALE_SCHEDULE_CLAIM_MS / 1000
  const cleanupGraceSeconds = RESERVATION_TTL_BUFFER_MS / 1000
  return and(
    activeScheduleExecutionJobsFilter(),
    or(
      isNull(asyncJobs.startedAt),
      sql`${asyncJobs.startedAt} + (
        CASE
          WHEN jsonb_typeof(${asyncJobs.metadata} -> 'maxDurationSeconds') = 'number'
            AND (${asyncJobs.metadata} ->> 'maxDurationSeconds')::double precision > 0
            THEN (${asyncJobs.metadata} ->> 'maxDurationSeconds')::double precision
          WHEN jsonb_typeof(${asyncJobs.payload} -> 'executionTimeoutMs') = 'number'
            AND (${asyncJobs.payload} ->> 'executionTimeoutMs')::double precision > 0
            THEN (${asyncJobs.payload} ->> 'executionTimeoutMs')::double precision / 1000 + ${cleanupGraceSeconds}
          ELSE ${legacyMaxDurationSeconds}
        END
      ) * interval '1 second' <= ${sql.param(now, asyncJobs.startedAt)}`
    )
  )
}

/**
 * Recovery cadence for an occurrence the worker never got to account for.
 *
 * Deployment refuses to persist a schedule without a valid cron expression
 * (`deployScheduleBlocks` writes `validateScheduleBlock`'s `cronExpression`,
 * and an invalid one fails the deploy), so every reachable schedule takes the
 * cron branch and lands on its real cadence. The day fallback exists only so a
 * row that somehow violates that invariant still advances instead of re-firing
 * the same occurrence forever — log it, because the cadence it picks is a
 * guess.
 */
function getScheduleNextRunAt(
  schedule: { scheduleId?: string; cronExpression?: string | null; timezone?: string },
  now: Date
): Date {
  const nextRunAt = getNextRunFromCronExpression(schedule.cronExpression, schedule.timezone)
  if (nextRunAt) return nextRunAt

  logger.warn('Recovering a schedule with no cron expression; falling back to a daily cadence', {
    scheduleId: schedule.scheduleId,
    timezone: schedule.timezone,
  })
  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}

function isTerminalJobStatus(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status)
}

function classifyScheduleRecoveryEvidence(
  status: string | null,
  logFound: boolean
): ScheduleRecoveryEvidence {
  switch (status) {
    case 'completed':
      return { outcome: 'success', executionStatus: status, logFound }
    case 'pending':
    case 'paused':
      return { outcome: 'paused', executionStatus: status, logFound }
    case 'failed':
      return { outcome: 'failure', executionStatus: status, logFound }
    case 'cancelled':
      return { outcome: 'cancelled', executionStatus: status, logFound }
    default:
      return { outcome: 'indeterminate', executionStatus: status, logFound }
  }
}

/**
 * Turns a carrier and its persisted execution log into the single outcome both
 * recovery paths act on. A log belonging to another workflow counts as no
 * evidence, and a carrier the queue already cancelled resolves as a
 * cancellation when its execution left no log behind.
 */
function buildScheduleRecoveryEvidence(
  payload: ScheduleRecoveryMetadata | null,
  executionLog: { workflowId: string | null; status: string } | null | undefined,
  carrierStatus: string
): ScheduleRecoveryEvidence {
  const ownLog =
    executionLog && executionLog.workflowId === payload?.workflowId ? executionLog : null
  const evidence = classifyScheduleRecoveryEvidence(ownLog?.status ?? null, Boolean(ownLog))

  if (!evidence.logFound && carrierStatus === JOB_STATUS.CANCELLED) {
    return { outcome: 'cancelled', executionStatus: null, logFound: false }
  }

  return evidence
}

/** Loads the execution log a carrier points at, for the single-carrier path. */
async function getScheduleExecutionLog(payload: ScheduleRecoveryMetadata | null) {
  if (!payload?.executionId) return null

  const [executionLog] = await db
    .select({
      workflowId: workflowExecutionLogs.workflowId,
      status: workflowExecutionLogs.status,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, payload.executionId))
    .limit(1)

  return executionLog ?? null
}

/**
 * Projects a recovered occurrence onto schedule accounting. Every write is
 * claim-guarded, so a schedule someone else has since re-claimed is left alone.
 */
async function applyScheduleRecoveryAccounting(params: {
  payload: ScheduleRecoveryMetadata
  evidence: ScheduleRecoveryEvidence
  now: Date
  requestId: string
  executor?: DbOrTx
}): Promise<{ disabled: boolean; updated: boolean }> {
  const { payload, evidence, now, requestId, executor } = params
  const claimedAt = getSchedulePayloadClaimedAt(payload)
  if (!claimedAt) return { disabled: false, updated: false }

  const nextRunAt = getScheduleNextRunAt(payload, now)
  const context = `Error reconciling schedule ${payload.scheduleId} after ${evidence.outcome} recovery`

  if (evidence.outcome === 'success' || evidence.outcome === 'paused') {
    const updated = await applyScheduleSuccessUpdate({
      scheduleId: payload.scheduleId,
      now,
      nextRunAt,
      expectedLastQueuedAt: claimedAt,
      requestId,
      context,
      executor,
    })
    return { disabled: false, updated }
  }

  if (evidence.outcome === 'cancelled') {
    const updated = await applyScheduleCancellationUpdate({
      scheduleId: payload.scheduleId,
      now,
      nextRunAt,
      expectedLastQueuedAt: claimedAt,
      requestId,
      context,
      executor,
    })
    return { disabled: false, updated }
  }

  const result = await applyScheduleFailureUpdate({
    scheduleId: payload.scheduleId,
    now,
    nextRunAt,
    expectedLastQueuedAt: claimedAt,
    requestId,
    context,
    executor,
  })
  return { disabled: result.disabled, updated: result.updated }
}

/**
 * Reconciles a recovered occurrence, retrying once through a restored claim.
 * A worker that released the claim without advancing `nextRunAt` leaves the
 * occurrence unaccounted for; re-taking the claim on that exact occurrence is
 * what lets the outcome be applied instead of silently replayed.
 */
async function reconcileRecoveredScheduleAccounting(params: {
  payload: ScheduleRecoveryMetadata
  evidence: ScheduleRecoveryEvidence
  now: Date
  requestId: string
  executor: DbOrTx
}): Promise<{ disabled: boolean; reconciled: boolean }> {
  const firstAttempt = await applyScheduleRecoveryAccounting(params)
  if (firstAttempt.updated) {
    return { disabled: firstAttempt.disabled, reconciled: true }
  }

  const claimedAt = getSchedulePayloadClaimedAt(params.payload)
  const scheduledFor = params.payload.scheduledFor ? new Date(params.payload.scheduledFor) : null
  if (!claimedAt || !scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    return { disabled: false, reconciled: false }
  }

  const [schedule] = await params.executor
    .select({
      archivedAt: workflowSchedule.archivedAt,
      lastQueuedAt: workflowSchedule.lastQueuedAt,
      nextRunAt: workflowSchedule.nextRunAt,
      status: workflowSchedule.status,
    })
    .from(workflowSchedule)
    .where(eq(workflowSchedule.id, params.payload.scheduleId))
    .for('update')

  if (
    !schedule ||
    schedule.archivedAt ||
    schedule.status === 'disabled' ||
    schedule.status === 'completed' ||
    !schedule.nextRunAt ||
    schedule.nextRunAt.getTime() !== scheduledFor.getTime()
  ) {
    return { disabled: false, reconciled: true }
  }

  if (schedule.lastQueuedAt) {
    return { disabled: false, reconciled: false }
  }

  const [restored] = await params.executor
    .update(workflowSchedule)
    .set({ lastQueuedAt: claimedAt, updatedAt: params.now })
    .where(
      and(
        eq(workflowSchedule.id, params.payload.scheduleId),
        isNull(workflowSchedule.archivedAt),
        eq(workflowSchedule.nextRunAt, scheduledFor),
        isNull(workflowSchedule.lastQueuedAt)
      )
    )
    .returning({ id: workflowSchedule.id })

  if (!restored) return { disabled: false, reconciled: false }

  const retry = await applyScheduleRecoveryAccounting(params)
  return { disabled: retry.disabled, reconciled: retry.updated }
}

async function markClaimedScheduleFailed(
  schedule: DatabaseScheduleExecutionTarget,
  requestId: string,
  expectedLastQueuedAt: Date,
  context: string
): Promise<void> {
  const now = new Date()
  const { disabled } = await applyScheduleFailureUpdate({
    scheduleId: schedule.id,
    now,
    nextRunAt: getScheduleNextRunAt(schedule, now),
    expectedLastQueuedAt,
    requestId,
    context,
  })

  if (disabled) {
    await notifyScheduleAutoDisabled({
      scheduleId: schedule.id,
      reason: 'consecutive_failures',
      requestId,
    })
  }
}

/**
 * Resolves a schedule occurrence whose carrier already exists, from the
 * carrier's persisted execution log rather than by redispatching it. Set
 * `cancelCarrier` when the carrier is still live and must be stopped first.
 */
async function reconcileExistingScheduleJob(params: {
  job: Job
  schedule: DatabaseScheduleExecutionTarget
  currentClaim: Date
  requestId: string
  jobQueue: JobQueue
  cancelCarrier: boolean
}): Promise<void> {
  const { job, schedule, currentClaim, requestId, jobQueue, cancelCarrier } = params
  const metadata = getScheduleRecoveryMetadataFromJob(job)
  const metadataClaim = getSchedulePayloadClaimedAt(metadata)
  const scheduleWorkflowId = schedule.workflowId
  const validMetadata =
    metadata &&
    metadataClaim &&
    scheduleWorkflowId &&
    metadata.scheduleId === schedule.id &&
    metadata.workflowId === scheduleWorkflowId
      ? metadata
      : null

  if (cancelCarrier) {
    await jobQueue.cancelJob(job.id)
  }

  if (!scheduleWorkflowId) {
    logger.warn(`[${requestId}] Cannot reconcile schedule job without a workflow`, {
      scheduleId: schedule.id,
      jobId: job.id,
    })
    return
  }

  if (validMetadata && metadataClaim) {
    const restored = await restoreScheduleClaim(
      schedule.id,
      requestId,
      currentClaim,
      metadataClaim,
      `Failed to restore schedule ${schedule.id} claim for recovery`
    )
    if (!restored) {
      logger.info(`[${requestId}] Skipped schedule reconciliation after claim changed`, {
        scheduleId: schedule.id,
        jobId: job.id,
      })
      return
    }
  }

  const recoveryPayload: ScheduleRecoveryMetadata =
    validMetadata ??
    ({
      scheduleId: schedule.id,
      workflowId: scheduleWorkflowId,
      now: currentClaim.toISOString(),
      cronExpression: schedule.cronExpression ?? undefined,
      timezone: schedule.timezone,
    } satisfies ScheduleRecoveryMetadata)
  const evidence = buildScheduleRecoveryEvidence(
    validMetadata,
    validMetadata ? await getScheduleExecutionLog(validMetadata) : null,
    job.status
  )
  const { disabled } = await applyScheduleRecoveryAccounting({
    payload: recoveryPayload,
    evidence,
    now: new Date(),
    requestId,
  })

  if (disabled) {
    await notifyScheduleAutoDisabled({
      scheduleId: schedule.id,
      reason: 'consecutive_failures',
      requestId,
    })
  }
}

async function deferClaimedScheduleAfterQueueFailure(
  schedule: ClaimedSchedule,
  requestId: string,
  expectedLastQueuedAt: Date,
  error: unknown,
  context: string
): Promise<void> {
  const now = new Date()
  const retryAttempt = (schedule.infraRetryCount || 0) + 1
  if (retryAttempt > SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS) {
    await markClaimedScheduleFailed(
      schedule,
      requestId,
      expectedLastQueuedAt,
      `Failed to mark schedule ${schedule.id} failed after queue retry exhaustion`
    )
    return
  }

  const retryDelayMs = calculateScheduleInfraRetryDelayMs(retryAttempt)
  const nextRetryAt = new Date(now.getTime() + retryDelayMs)

  logger.warn(`[${requestId}] Deferring schedule after queue infrastructure failure`, {
    scheduleId: schedule.id,
    workflowId: schedule.workflowId,
    retryAttempt,
    retryDelayMs,
    error: toError(error).message,
  })

  await db
    .update(workflowSchedule)
    .set({
      updatedAt: now,
      nextRunAt: nextRetryAt,
      lastQueuedAt: null,
      infraRetryCount: retryAttempt,
    })
    .where(
      and(
        eq(workflowSchedule.id, schedule.id),
        isNull(workflowSchedule.archivedAt),
        eq(workflowSchedule.lastQueuedAt, expectedLastQueuedAt)
      )
    )
    .catch((updateError) => {
      logger.error(`[${requestId}] ${context}`, updateError)
      throw updateError
    })
}

async function handleClaimedScheduleSetupFailure(
  schedule: ClaimedSchedule,
  requestId: string,
  expectedLastQueuedAt: Date,
  error: unknown,
  retryContext: string,
  failureContext: string
): Promise<void> {
  const retryable = isAsyncJobEnqueueError(error)
    ? error.retryable
    : isRetryableInfrastructureError(error)
  if (retryable) {
    await deferClaimedScheduleAfterQueueFailure(
      schedule,
      requestId,
      expectedLastQueuedAt,
      error,
      retryContext
    )
    return
  }

  logger.error(`[${requestId}] Non-retryable schedule setup failure`, {
    scheduleId: schedule.id,
    workflowId: schedule.workflowId,
    error: toError(error).message,
  })
  await markClaimedScheduleFailed(schedule, requestId, expectedLastQueuedAt, failureContext)
}

async function recoverStaleDatabaseScheduleJobs(now: Date): Promise<void> {
  /**
   * Collected inside the transaction, flushed after it commits. Emailing inside
   * would both notify about writes a rollback discards and issue pooled-client
   * reads while the transaction still holds row locks under the advisory lock.
   */
  const disabledScheduleIds = new Set<string>()

  await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${SCHEDULE_EXECUTION_QUEUE_NAME}, 0)) AS acquired`
    )
    if (!lock?.acquired) {
      logger.info(
        'Skipped stale database schedule job recovery because another worker holds the lock'
      )
      return
    }

    const claimedRows = await tx
      .select({
        id: asyncJobs.id,
        payload: asyncJobs.payload,
        status: asyncJobs.status,
      })
      .from(asyncJobs)
      .where(
        or(
          staleScheduleExecutionJobsFilter(now),
          pendingScheduleExecutionJobsFilter(now, { claimed: true }),
          unreconciledTerminalScheduleExecutionJobsFilter()
        )
      )
      .for('update', { skipLocked: true })
      .orderBy(asc(asyncJobs.updatedAt), asc(asyncJobs.id))
      .limit(STALE_SCHEDULE_RECOVERY_BATCH_SIZE)

    const payloads = new Map(
      claimedRows.map((row) => [row.id, getScheduleRecoveryMetadataFromValue(row.payload)])
    )
    const executionIds = Array.from(
      new Set(
        claimedRows.flatMap((row) => {
          const executionId = payloads.get(row.id)?.executionId
          return executionId ? [executionId] : []
        })
      )
    )
    const executionLogs =
      executionIds.length > 0
        ? await tx
            .select({
              executionId: workflowExecutionLogs.executionId,
              workflowId: workflowExecutionLogs.workflowId,
              status: workflowExecutionLogs.status,
            })
            .from(workflowExecutionLogs)
            .where(inArray(workflowExecutionLogs.executionId, executionIds))
        : []
    const executionLogsById = new Map(executionLogs.map((log) => [log.executionId, log]))

    for (const row of claimedRows) {
      const payload = payloads.get(row.id) ?? null
      const recoveryEvidence = buildScheduleRecoveryEvidence(
        payload,
        payload?.executionId ? executionLogsById.get(payload.executionId) : null,
        row.status
      )

      const knownOutcome = recoveryEvidence.outcome !== 'indeterminate'

      /**
       * A carrier that already reached a terminal status recorded its own
       * outcome; recovery only owes it schedule accounting and the reconciled
       * marker. Rewriting it would clobber the worker's `completedAt`, error
       * and output — which `GET /api/jobs/[jobId]` surfaces — and would flip a
       * genuinely completed run to failed whenever its execution log has aged
       * out. Only a carrier still in flight is settled here.
       */
      if (!isTerminalJobStatus(row.status)) {
        const [settledJob] = await tx
          .update(asyncJobs)
          .set({
            status: knownOutcome ? JOB_STATUS.COMPLETED : JOB_STATUS.FAILED,
            completedAt: now,
            error: knownOutcome
              ? null
              : `Indeterminate schedule execution outcome${recoveryEvidence.executionStatus ? ` (${recoveryEvidence.executionStatus})` : ''}`,
            output: knownOutcome
              ? {
                  recovered: true,
                  executionId: payload?.executionId ?? null,
                  executionStatus: recoveryEvidence.executionStatus,
                }
              : null,
            updatedAt: now,
          })
          .where(and(eq(asyncJobs.id, row.id), eq(asyncJobs.status, row.status)))
          .returning({ id: asyncJobs.id })

        if (!settledJob) continue
      }
      if (!payload) {
        await tx
          .update(asyncJobs)
          .set({
            metadata: buildCarrierReconciledMetadata(asyncJobs.metadata, { irrecoverable: true }),
            updatedAt: now,
          })
          .where(eq(asyncJobs.id, row.id))
        continue
      }

      const { disabled, reconciled } = await reconcileRecoveredScheduleAccounting({
        payload,
        evidence: recoveryEvidence,
        now,
        requestId: 'stale-schedule-recovery',
        executor: tx,
      })

      if (disabled) disabledScheduleIds.add(payload.scheduleId)

      /**
       * `updatedAt` is bumped even when accounting was deferred. The batch is
       * ordered by `updatedAt`, so a carrier that keeps failing to reconcile —
       * a newer claim holds the schedule, or the payload carries no
       * `scheduledFor` to match an occurrence against — would otherwise sit at
       * the head of every tick forever and starve every other claimed carrier
       * out of the batch. Only the reconciled marker gates retention; the bump
       * just rotates the row to the back of the queue.
       */
      await tx
        .update(asyncJobs)
        .set(
          reconciled
            ? { metadata: buildCarrierReconciledMetadata(asyncJobs.metadata), updatedAt: now }
            : { updatedAt: now }
        )
        .where(eq(asyncJobs.id, row.id))
    }
  })

  const disabledScheduleIdList = Array.from(disabledScheduleIds)
  const notifiable = disabledScheduleIdList.slice(0, STALE_SCHEDULE_RECOVERY_NOTIFY_LIMIT)
  if (disabledScheduleIdList.length > notifiable.length) {
    logger.warn('Capped schedule auto-disable notifications for stale recovery batch', {
      disabled: disabledScheduleIdList.length,
      notified: notifiable.length,
    })
  }

  for (const scheduleId of notifiable) {
    await notifyScheduleAutoDisabled({
      scheduleId,
      reason: 'consecutive_failures',
      requestId: 'stale-schedule-recovery',
    })
  }
}

function isStaleDatabaseScheduleJob(job: {
  status: string
  startedAt?: Date
  metadata?: unknown
  payload?: unknown
}): boolean {
  return (
    job.status === JOB_STATUS.PROCESSING &&
    (!job.startedAt || job.startedAt.getTime() + getScheduleExecutionLeaseMs(job) <= Date.now())
  )
}

async function getDatabaseScheduleExecutionSlots(): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(asyncJobs)
    .where(activeScheduleExecutionJobsFilter())

  const processingCount = Number(row?.count ?? 0)
  return Math.max(0, SCHEDULE_EXECUTION_CONCURRENCY_LIMIT - processingCount)
}

async function tryStartDatabaseScheduleJob(jobId: string): Promise<DatabaseScheduleStartResult> {
  const now = new Date()

  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${SCHEDULE_EXECUTION_QUEUE_NAME}, 0)) AS acquired`
    )
    if (!lock?.acquired) return 'capacity_full'

    const [row] = await tx
      .select({
        count: sql<number>`count(*)`,
      })
      .from(asyncJobs)
      .where(activeScheduleExecutionJobsFilter())

    if (Number(row?.count ?? 0) >= SCHEDULE_EXECUTION_CONCURRENCY_LIMIT) {
      return 'capacity_full'
    }

    const [startedJob] = await tx
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.PROCESSING,
        startedAt: now,
        attempts: sql`${asyncJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(asyncJobs.id, jobId),
          eq(asyncJobs.type, 'schedule-execution'),
          eq(asyncJobs.status, JOB_STATUS.PENDING),
          eq(asyncJobs.attempts, 0)
        )
      )
      .returning({ id: asyncJobs.id })

    return startedJob ? 'started' : 'not_pending'
  })
}

/**
 * Cancels an untouched pending carrier whose schedule claim was released, and
 * stamps it reconciled so retention can collect it.
 */
async function cancelReleasedPendingDatabaseScheduleCarrier(jobId: string): Promise<boolean> {
  const now = new Date()
  const [cancelled] = await db
    .update(asyncJobs)
    .set({
      status: JOB_STATUS.CANCELLED,
      completedAt: now,
      error: 'Cancelled after schedule claim was released',
      metadata: buildCarrierReconciledMetadata(asyncJobs.metadata),
      updatedAt: now,
    })
    .where(
      and(
        eq(asyncJobs.id, jobId),
        eq(asyncJobs.type, 'schedule-execution'),
        eq(asyncJobs.status, JOB_STATUS.PENDING),
        eq(asyncJobs.attempts, 0)
      )
    )
    .returning({ id: asyncJobs.id })

  return Boolean(cancelled)
}

async function executeDatabaseScheduleJob(
  jobQueue: JobQueue,
  jobId: string,
  payload: ScheduleExecutionPayload,
  schedule: DatabaseScheduleExecutionTarget,
  queuedAt: Date,
  requestId: string,
  delayMs: number
): Promise<void> {
  if (delayMs > 0) await sleep(delayMs)

  const startResult = await runWithDatabaseScheduleStartTurn(() =>
    tryStartDatabaseScheduleJob(jobId)
  )
  if (startResult === 'not_pending') {
    logger.info(`[${requestId}] Database schedule execution job is no longer pending`, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      jobId,
    })
    return
  }

  if (startResult === 'capacity_full') {
    logger.info(`[${requestId}] Deferred database schedule execution because capacity is full`, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      jobId,
      concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
    })
    return
  }

  const executionId = payload.executionId ?? payload.correlation?.executionId ?? generateId()
  const executionPayload = payload.executionId ? payload : { ...payload, executionId }
  const abortController = new AbortController()
  registerManualExecutionAborter(executionId, () => {
    abortController.abort(new DOMException('Execution cancelled by user', 'AbortError'))
  })

  try {
    const output = await executeScheduleJob(executionPayload, abortController.signal)
    await jobQueue.completeJob(jobId, output ?? null)
  } catch (error) {
    const errorMessage = toError(error).message
    logger.error(`[${requestId}] Schedule execution failed for workflow ${schedule.workflowId}`, {
      scheduleId: schedule.id,
      jobId,
      error: errorMessage,
    })
    await jobQueue.markJobFailed(jobId, errorMessage)
    await releaseScheduleLock(
      schedule.id,
      requestId,
      new Date(),
      `Failed to release lock for schedule ${schedule.id} after inline execution failure`,
      undefined,
      { expectedLastQueuedAt: queuedAt }
    )
  } finally {
    unregisterManualExecutionAborter(executionId)
  }
}

async function getPendingDatabaseScheduleJobs(limit: number) {
  if (limit <= 0) return []
  const now = new Date()

  return db
    .select({
      id: asyncJobs.id,
      payload: asyncJobs.payload,
    })
    .from(asyncJobs)
    .where(pendingScheduleExecutionJobsFilter(now))
    .orderBy(asc(asyncJobs.runAt), asc(asyncJobs.createdAt), asc(asyncJobs.id))
    .limit(limit)
}

function getScheduleTargetFromPayload(
  payload: ScheduleExecutionPayload
): DatabaseScheduleExecutionTarget {
  return {
    id: payload.scheduleId,
    workflowId: payload.workflowId,
    cronExpression: payload.cronExpression ?? null,
    timezone: payload.timezone ?? 'UTC',
  }
}

async function getScheduleClaimState(
  payload: ScheduleRecoveryMetadata,
  claimedAt: Date
): Promise<'matches' | 'released' | 'claimed_by_other'> {
  const [schedule] = await db
    .select({
      lastQueuedAt: workflowSchedule.lastQueuedAt,
    })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, payload.scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  if (!schedule?.lastQueuedAt) return 'released'
  return schedule.lastQueuedAt.getTime() === claimedAt.getTime() ? 'matches' : 'claimed_by_other'
}

async function resumePendingDatabaseScheduleJobs(
  jobQueue: JobQueue,
  requestId: string,
  slots: number
): Promise<number> {
  const pendingJobs = await getPendingDatabaseScheduleJobs(slots)
  if (pendingJobs.length === 0) return 0

  const results = await Promise.allSettled(
    pendingJobs.map(async (job) => {
      const recoveryMetadata = getScheduleRecoveryMetadataFromValue(job.payload)
      const claimedAt = getSchedulePayloadClaimedAt(recoveryMetadata)
      if (!recoveryMetadata || !claimedAt) {
        await jobQueue.markJobFailed(job.id, 'Invalid pending schedule recovery metadata')
        return true
      }

      const claimState = await getScheduleClaimState(recoveryMetadata, claimedAt)
      if (claimState === 'released') {
        logger.info(`[${requestId}] Cancelling stale pending schedule execution job`, {
          scheduleId: recoveryMetadata.scheduleId,
          workflowId: recoveryMetadata.workflowId,
          jobId: job.id,
        })
        return cancelReleasedPendingDatabaseScheduleCarrier(job.id)
      }
      if (claimState === 'claimed_by_other') {
        logger.info(`[${requestId}] Leaving pending schedule execution job for active claimant`, {
          scheduleId: recoveryMetadata.scheduleId,
          workflowId: recoveryMetadata.workflowId,
          jobId: job.id,
        })
        return false
      }

      const payloadValidation = getSchedulePayloadValidation(job.payload)
      if (!payloadValidation.success) {
        const error = `Invalid pending schedule execution payload: ${payloadValidation.error}`
        logger.warn(`[${requestId}] Rejecting invalid pending schedule execution payload`, {
          scheduleId: recoveryMetadata.scheduleId,
          workflowId: recoveryMetadata.workflowId,
          jobId: job.id,
          error,
        })
        await jobQueue.markJobFailed(job.id, error)
        await releaseScheduleLock(
          recoveryMetadata.scheduleId,
          requestId,
          new Date(),
          `Released schedule ${recoveryMetadata.scheduleId} after rejecting invalid pending schedule execution payload`,
          undefined,
          { expectedLastQueuedAt: claimedAt }
        )
        return true
      }

      logger.info(`[${requestId}] Resuming pending database schedule execution job`, {
        scheduleId: recoveryMetadata.scheduleId,
        workflowId: recoveryMetadata.workflowId,
        jobId: job.id,
      })

      await executeDatabaseScheduleJob(
        jobQueue,
        job.id,
        payloadValidation.payload,
        getScheduleTargetFromPayload(payloadValidation.payload),
        claimedAt,
        requestId,
        0
      )
      return true
    })
  )

  let processedCount = 0
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      processedCount += 1
      return
    }

    if (result.status === 'rejected') {
      logger.error(`[${requestId}] Failed to resume pending database schedule execution job`, {
        jobId: pendingJobs[index]?.id,
        error: toError(result.reason).message,
      })
    }
  })

  return processedCount
}

async function processScheduleItem(
  schedule: ClaimedSchedule,
  queuedAt: Date,
  requestId: string,
  jobQueue: JobQueue,
  useDatabaseFallback: boolean
) {
  const queueTime = schedule.lastQueuedAt ?? queuedAt
  const scheduleJobId = buildScheduleExecutionJobId(schedule)
  let enqueuedJobId: string | null = null
  let carrierObservedOrLookupUncertain = false

  try {
    carrierObservedOrLookupUncertain = true
    const existingJob = await jobQueue.getJob(scheduleJobId)
    if (!existingJob) carrierObservedOrLookupUncertain = false
    const delayMs = randomInt(0, SCHEDULE_JITTER_MAX_MS)

    if (existingJob && ['pending', 'processing'].includes(existingJob.status)) {
      const activeJobPayload = getScheduleRecoveryMetadataFromJob(existingJob)
      const activeJobClaim = getSchedulePayloadClaimedAt(activeJobPayload)

      if (
        useDatabaseFallback &&
        (isStaleDatabaseScheduleJob(existingJob) ||
          (existingJob.status === JOB_STATUS.PENDING && existingJob.attempts > 0))
      ) {
        await recoverStaleDatabaseScheduleJobs(new Date())
        logger.info(`[${requestId}] Reconciled claimed database schedule execution jobs`, {
          scheduleId: schedule.id,
          jobId: scheduleJobId,
        })
      }

      const databaseJob = useDatabaseFallback ? await jobQueue.getJob(scheduleJobId) : existingJob
      const databaseJobPayload = databaseJob
        ? getScheduleRecoveryMetadataFromJob(databaseJob)
        : null
      const databaseJobClaim = getSchedulePayloadClaimedAt(databaseJobPayload) ?? activeJobClaim
      if (
        !useDatabaseFallback &&
        activeJobClaim &&
        isStaleScheduleClaim(activeJobClaim, existingJob)
      ) {
        logger.warn(`[${requestId}] Cancelling stale schedule execution job`, {
          scheduleId: schedule.id,
          jobId: existingJob.id,
          claimedAt: activeJobClaim.toISOString(),
        })
        await reconcileExistingScheduleJob({
          job: existingJob,
          schedule,
          currentClaim: queueTime,
          requestId,
          jobQueue,
          cancelCarrier: true,
        })
        return
      }

      if (
        useDatabaseFallback &&
        databaseJob?.status === JOB_STATUS.PENDING &&
        databaseJob.attempts === 0
      ) {
        const payloadValidation = getSchedulePayloadValidation(databaseJob.payload)
        if (!payloadValidation.success) {
          const error = `Invalid pending schedule execution payload: ${payloadValidation.error}`
          logger.warn(`[${requestId}] Rejecting invalid pending schedule execution payload`, {
            scheduleId: schedule.id,
            workflowId: schedule.workflowId,
            jobId: scheduleJobId,
            error,
          })
          enqueuedJobId = scheduleJobId
          await jobQueue.markJobFailed(scheduleJobId, error)
          await releaseScheduleLock(
            schedule.id,
            requestId,
            queuedAt,
            `Released schedule ${schedule.id} after rejecting invalid pending schedule execution payload`,
            undefined,
            { expectedLastQueuedAt: queueTime }
          )
          return
        }

        logger.info(`[${requestId}] Resuming pending database schedule execution job`, {
          scheduleId: schedule.id,
          jobId: scheduleJobId,
        })
        if (databaseJobClaim) {
          const restored = await restoreScheduleClaim(
            schedule.id,
            requestId,
            queueTime,
            databaseJobClaim,
            `Failed to restore schedule ${schedule.id} claim for pending database fallback job`
          )
          if (!restored) return
        }
        enqueuedJobId = scheduleJobId
        await executeDatabaseScheduleJob(
          jobQueue,
          scheduleJobId,
          payloadValidation.payload,
          schedule,
          databaseJobClaim ?? queueTime,
          requestId,
          delayMs
        )
        return
      }
      if (
        useDatabaseFallback &&
        databaseJob &&
        databaseJob.status !== JOB_STATUS.PENDING &&
        databaseJob.status !== JOB_STATUS.PROCESSING
      ) {
        logger.info(`[${requestId}] Database schedule execution job reached terminal state`, {
          scheduleId: schedule.id,
          jobId: scheduleJobId,
          status: databaseJob.status,
        })
        await reconcileExistingScheduleJob({
          job: databaseJob,
          schedule,
          currentClaim: queueTime,
          requestId,
          jobQueue,
          cancelCarrier: false,
        })
        return
      }

      logger.info(`[${requestId}] Schedule execution job already exists`, {
        scheduleId: schedule.id,
        jobId: scheduleJobId,
        status: databaseJob?.status ?? existingJob.status,
      })
      const shouldRestoreActiveClaim =
        activeJobClaim &&
        (!useDatabaseFallback ||
          databaseJob?.status !== JOB_STATUS.PROCESSING ||
          !isStaleScheduleClaim(activeJobClaim, existingJob))

      if (shouldRestoreActiveClaim) {
        await restoreScheduleClaim(
          schedule.id,
          requestId,
          queueTime,
          activeJobClaim,
          `Failed to restore schedule ${schedule.id} claim for active schedule execution job`
        )
      }
      return
    }
    if (existingJob) {
      logger.info(`[${requestId}] Reconciling schedule claim for finished job`, {
        scheduleId: schedule.id,
        jobId: scheduleJobId,
        status: existingJob.status,
      })
      await reconcileExistingScheduleJob({
        job: existingJob,
        schedule,
        currentClaim: queueTime,
        requestId,
        jobQueue,
        cancelCarrier: false,
      })
      return
    }

    const executionId = generateId()
    const workspaceId = schedule.workspaceId ?? undefined
    let billingAttribution: BillingAttributionSnapshot
    try {
      if (!workspaceId) {
        throw new Error(`Unable to resolve workspace for schedule ${schedule.id}`)
      }
      billingAttribution = await resolveSystemBillingAttribution(workspaceId)
    } catch (error) {
      await handleClaimedScheduleSetupFailure(
        schedule,
        requestId,
        queueTime,
        error,
        `Failed to defer schedule ${schedule.id} after billing attribution failure`,
        `Failed to mark schedule ${schedule.id} failed after billing attribution failure`
      )
      return
    }
    const correlation = {
      executionId,
      requestId,
      source: 'schedule' as const,
      workflowId: schedule.workflowId!,
      scheduleId: schedule.id,
      triggerType: 'schedule',
      scheduledFor: schedule.nextRunAt?.toISOString(),
    }
    const executionTimeoutMs = getExecutionTimeout(
      billingAttribution.payerSubscription?.plan,
      'async',
      billingAttribution.payerSubscription?.enterpriseWorkflowExecutionTimeoutSeconds
    )
    const payload = {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId!,
      executionId,
      requestId,
      correlation,
      blockId: schedule.blockId || undefined,
      workspaceId,
      billingAttribution,
      deploymentVersionId: schedule.deploymentVersionId || undefined,
      deploymentOperationId: schedule.deploymentOperationId || undefined,
      cronExpression: schedule.cronExpression || undefined,
      timezone: schedule.timezone || undefined,
      lastRanAt: schedule.lastRanAt?.toISOString(),
      failedCount: schedule.failedCount || 0,
      infraRetryCount: schedule.infraRetryCount || 0,
      now: queueTime.toISOString(),
      scheduledFor: schedule.nextRunAt?.toISOString(),
      executionTimeoutMs,
    } satisfies ScheduleExecutionPayload

    let jobId: string
    try {
      jobId = await jobQueue.enqueue(SCHEDULE_EXECUTION_QUEUE_NAME, payload, {
        jobId: scheduleJobId,
        delayMs,
        maxDurationSeconds: toTriggerMaxDurationSeconds(executionTimeoutMs),
        metadata: {
          workflowId: schedule.workflowId ?? undefined,
          workspaceId: schedule.workspaceId ?? undefined,
          correlation,
        },
      })
      enqueuedJobId = jobId
    } catch (error) {
      const classifiedError = isAsyncJobEnqueueError(error) ? error : null
      const acceptance = classifiedError?.acceptance ?? 'unknown'
      logger.error(
        `[${requestId}] Failed to enqueue schedule execution for workflow ${schedule.workflowId}`,
        error,
        { acceptance, jobId: scheduleJobId }
      )
      /**
       * The queue may have accepted the job before the response was lost, and
       * the job id is deterministic, so retrying could double-dispatch the
       * occurrence. Leave the claim in place and let the next tick reconcile
       * against whatever carrier actually exists.
       */
      if (acceptance !== 'rejected') return
      await handleClaimedScheduleSetupFailure(
        schedule,
        requestId,
        queueTime,
        error,
        `Failed to defer schedule ${schedule.id} after enqueue failure`,
        `Failed to mark schedule ${schedule.id} failed after non-retryable enqueue failure`
      )
      return
    }

    logger.info(
      `[${requestId}] Queued schedule execution task ${jobId} for workflow ${schedule.workflowId}`
    )

    if (useDatabaseFallback) {
      logger.info(`[${requestId}] Executing durable database schedule execution job`, {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        jobId,
        delayMs,
        concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
      })
      await executeDatabaseScheduleJob(
        jobQueue,
        jobId,
        payload,
        schedule,
        queueTime,
        requestId,
        delayMs
      )
      return
    }

    const queuedJob = await jobQueue.getJob(jobId)
    if (queuedJob && !['pending', 'processing'].includes(queuedJob.status)) {
      logger.info(`[${requestId}] Schedule execution job already finished`, {
        scheduleId: schedule.id,
        jobId,
        status: queuedJob.status,
      })
      await reconcileExistingScheduleJob({
        job: queuedJob,
        schedule,
        currentClaim: queueTime,
        requestId,
        jobQueue,
        cancelCarrier: false,
      })
      return
    }
    if (queuedJob) {
      const queuedJobClaim = getSchedulePayloadClaimedAt(
        getScheduleRecoveryMetadataFromJob(queuedJob)
      )
      if (queuedJobClaim) {
        if (isStaleScheduleClaim(queuedJobClaim, queuedJob)) {
          logger.warn(`[${requestId}] Cancelling stale queued schedule execution job`, {
            scheduleId: schedule.id,
            jobId,
            claimedAt: queuedJobClaim.toISOString(),
          })
          await reconcileExistingScheduleJob({
            job: queuedJob,
            schedule,
            currentClaim: queueTime,
            requestId,
            jobQueue,
            cancelCarrier: true,
          })
          return
        }

        await restoreScheduleClaim(
          schedule.id,
          requestId,
          queueTime,
          queuedJobClaim,
          `Failed to restore schedule ${schedule.id} claim for queued schedule execution job`
        )
      }
    }

    logger.info(`[${requestId}] Schedule execution task accepted`, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      jobId,
      delayMs,
      concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
      backend: useDatabaseFallback ? 'database-fallback' : 'trigger-dev',
    })
  } catch (error) {
    logger.error(
      `[${requestId}] Failed after queueing schedule execution for workflow ${schedule.workflowId}`,
      error
    )
    if (!enqueuedJobId && !carrierObservedOrLookupUncertain) {
      await handleClaimedScheduleSetupFailure(
        schedule,
        requestId,
        queueTime,
        error,
        `Failed to defer schedule ${schedule.id} after pre-enqueue failure`,
        `Failed to mark schedule ${schedule.id} failed after non-retryable setup failure`
      )
      return
    }

    logger.warn(`[${requestId}] Preserved schedule occurrence after carrier uncertainty`, {
      scheduleId: schedule.id,
      jobId: enqueuedJobId ?? scheduleJobId,
      error: toError(error).message,
    })
  }
}

interface ScheduleTickResult {
  processedCount: number
  totalSchedules: number
}

/**
 * Drains due schedules, claiming and enqueuing work until the tick
 * budget is exhausted or no more items are due. Runs detached from the HTTP
 * response so the cron caller does not wait; cross-replica safety is provided by
 * the `FOR UPDATE SKIP LOCKED` claim layer, not this function.
 */
export async function runScheduleTick(requestId: string): Promise<ScheduleTickResult> {
  const tickStart = Date.now()

  const jobQueue = await getJobQueue()
  const useDatabaseFallback = shouldExecuteInline()
  let totalSchedules = 0
  let iterations = 0
  let remainingWorkflowBudget = SCHEDULE_WORKFLOW_ENQUEUE_LIMIT
  let schedulesExhausted = false
  while (Date.now() - tickStart < MAX_TICK_DURATION_MS) {
    if (schedulesExhausted) break
    const queuedAt = new Date()
    let resumedPendingSchedules = 0
    let databaseScheduleSlots = SCHEDULE_EXECUTION_CONCURRENCY_LIMIT

    if (useDatabaseFallback) {
      await recoverStaleDatabaseScheduleJobs(queuedAt)
      databaseScheduleSlots = await getDatabaseScheduleExecutionSlots()
      resumedPendingSchedules = await resumePendingDatabaseScheduleJobs(
        jobQueue,
        requestId,
        databaseScheduleSlots
      )
      databaseScheduleSlots = await getDatabaseScheduleExecutionSlots()
    }

    const workflowClaimLimit = Math.min(
      WORKFLOW_CHUNK_SIZE,
      remainingWorkflowBudget,
      useDatabaseFallback ? databaseScheduleSlots : WORKFLOW_CHUNK_SIZE
    )

    if (useDatabaseFallback && workflowClaimLimit <= 0) {
      schedulesExhausted = true
    }

    const dueSchedules = schedulesExhausted
      ? []
      : await claimWorkflowSchedules(queuedAt, workflowClaimLimit)

    remainingWorkflowBudget -= dueSchedules.length
    if (dueSchedules.length < workflowClaimLimit || remainingWorkflowBudget <= 0) {
      schedulesExhausted = true
    }

    if (dueSchedules.length === 0 && resumedPendingSchedules === 0) break

    iterations += 1
    totalSchedules += dueSchedules.length + resumedPendingSchedules

    logger.info(
      `[${requestId}] Iteration ${iterations}: claimed ${dueSchedules.length} schedules, resumed ${resumedPendingSchedules} pending schedule jobs`,
      {
        remainingWorkflowBudget,
        scheduleConcurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
        databaseScheduleSlots,
      }
    )

    const schedulePromises =
      dueSchedules.length > 0
        ? dueSchedules.map((schedule) =>
            processScheduleItem(schedule, queuedAt, requestId, jobQueue, useDatabaseFallback)
          )
        : []

    await Promise.allSettled(schedulePromises)
  }

  const totalCount = totalSchedules
  const durationMs = Date.now() - tickStart
  logger.info(
    `[${requestId}] Processed ${totalCount} items across ${iterations} iteration(s) in ${durationMs}ms`,
    {
      scheduleConcurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
      scheduleEnqueueBudget: SCHEDULE_WORKFLOW_ENQUEUE_LIMIT,
      remainingWorkflowBudget,
    }
  )

  return { processedCount: totalCount, totalSchedules }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(request, 'Schedule execution')
  if (authError) {
    return authError
  }

  runDetached('schedule-execution-tick', () => runScheduleTick(requestId))

  const response = {
    message: 'Scheduled execution started',
    status: 'started',
  } satisfies ExecuteSchedulesResponse

  return NextResponse.json(response, { status: 202 })
})
