import { trace } from '@opentelemetry/api'
import {
  db,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowSchedule,
} from '@sim/db'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { task, timeout } from '@trigger.dev/sdk'
import { Cron } from 'croner'
import { and, eq, isNull, ne, type SQL, sql } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { classifyTransientAdmissionFailure } from '@/lib/core/admission/transient-failure'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import {
  describeRetryableInfrastructureError,
  isRetryableInfrastructureError,
} from '@/lib/core/errors/retryable-infrastructure'
import {
  capExecutionTimeoutMs,
  createTimeoutAbortController,
  getAsyncExecutionTimeoutForBillingAttribution,
  getExecutionDeadlineAt,
  getTimeoutErrorMessage,
} from '@/lib/core/execution-limits'
import type { DbOrTx } from '@/lib/db/types'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { cleanupExecutionBase64Cache } from '@/lib/uploads/utils/user-file-base64.server'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { notifyScheduleAutoDisabled } from '@/lib/workflows/schedules/disable-notifications'
import type { ScheduleDisableReason } from '@/lib/workflows/schedules/disable-reasons'
import {
  SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  SCHEDULE_EXECUTION_QUEUE_NAME,
  SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS,
} from '@/lib/workflows/schedules/execution-limits'
import { calculateScheduleInfraRetryDelayMs } from '@/lib/workflows/schedules/retry'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
} from '@/lib/workflows/schedules/utils'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('ScheduleExecution')

type WorkflowRecord = typeof workflow.$inferSelect
type WorkflowScheduleInsert = typeof workflowSchedule.$inferInsert
type WorkflowScheduleUpdate = Partial<Omit<WorkflowScheduleInsert, 'failedCount' | 'status'>> & {
  failedCount?: WorkflowScheduleInsert['failedCount'] | SQL
  status?: WorkflowScheduleInsert['status'] | SQL
}
type ExecutionCoreResult = Awaited<ReturnType<typeof executeWorkflowCore>>

/** Result of a guarded schedule UPDATE. `status` is the row's value after the write. */
type ScheduleUpdateOutcome = {
  updated: boolean
  status: string | null
}

function incrementScheduleFailedCount(): SQL {
  return sql`COALESCE(${workflowSchedule.failedCount}, 0) + 1`
}

function scheduleStatusAfterFailedCountIncrement(): SQL {
  return sql`CASE WHEN COALESCE(${workflowSchedule.failedCount}, 0) + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN 'disabled' ELSE 'active' END`
}

function resetScheduleInfraRetryCount(): Pick<WorkflowScheduleUpdate, 'infraRetryCount'> {
  return { infraRetryCount: 0 }
}

/**
 * Builds the schedule update shared by every path that treats a run as a failure:
 * clears the claim, advances to `nextRunAt`, increments the consecutive-failure
 * counter, stamps `lastFailedAt`, and auto-disables once `MAX_CONSECUTIVE_FAILURES`
 * is reached. Centralizing this keeps all failure branches (preprocessing,
 * execution, exhausted infra retries, usage limit) from diverging — only the
 * `nextRunAt` cadence differs per caller.
 */
export function buildScheduleFailureUpdate(
  now: Date,
  nextRunAt: Date | null
): WorkflowScheduleUpdate {
  return {
    updatedAt: now,
    lastQueuedAt: null,
    nextRunAt,
    failedCount: incrementScheduleFailedCount(),
    lastFailedAt: now,
    status: scheduleStatusAfterFailedCountIncrement(),
    ...resetScheduleInfraRetryCount(),
  }
}

type RunWorkflowResult =
  | {
      status: 'skip'
      reason: 'stale_deployment' | 'invalid_schedule' | 'stale_claim'
      blocks: Record<string, BlockState>
    }
  | { status: 'success'; blocks: Record<string, BlockState>; executionResult: ExecutionCoreResult }
  | {
      status: 'cancelled'
      blocks: Record<string, BlockState>
      executionResult: ExecutionCoreResult
    }
  | { status: 'failure'; blocks: Record<string, BlockState>; executionResult: ExecutionCoreResult }
  | {
      status: 'retryable_setup_failure'
      error: unknown
      cause?: Record<string, unknown>
    }

export function buildScheduleCorrelation(
  payload: ScheduleExecutionPayload
): AsyncExecutionCorrelation {
  const executionId = payload.executionId || generateId()
  const requestId = payload.requestId || payload.correlation?.requestId || executionId.slice(0, 8)

  return {
    executionId,
    requestId,
    source: 'schedule',
    workflowId: payload.workflowId,
    scheduleId: payload.scheduleId,
    triggerType: payload.correlation?.triggerType || 'schedule',
    scheduledFor: payload.scheduledFor || payload.correlation?.scheduledFor,
  }
}

export function classifyScheduleExecutionResult(
  executionResult: { success: boolean; status?: string },
  timedOut: boolean,
  persistedStatus?: string | null
): 'success' | 'cancelled' | 'failure' {
  if (persistedStatus === 'cancelled') return 'cancelled'
  if (executionResult.success) return 'success'
  if (executionResult.status === 'cancelled' && !timedOut) return 'cancelled'
  return 'failure'
}

/** Advances cadence after user cancellation without mutating the failure counter. */
/**
 * Successful-run accounting: stamps `lastRanAt`, clears the claim, advances to
 * `nextRunAt`, and resets the consecutive-failure and infra-retry counters. The
 * sibling of {@link buildScheduleCancellationUpdate} and
 * {@link buildScheduleFailureUpdate}.
 */
export function buildScheduleSuccessUpdate(now: Date, nextRunAt: Date): WorkflowScheduleUpdate {
  return {
    lastRanAt: now,
    updatedAt: now,
    nextRunAt,
    failedCount: 0,
    lastQueuedAt: null,
    ...resetScheduleInfraRetryCount(),
  }
}

export function buildScheduleCancellationUpdate(
  now: Date,
  nextRunAt: Date
): WorkflowScheduleUpdate {
  return {
    lastRanAt: now,
    updatedAt: now,
    nextRunAt,
    lastQueuedAt: null,
    ...resetScheduleInfraRetryCount(),
  }
}

async function applyScheduleUpdate(
  scheduleId: string,
  updates: WorkflowScheduleUpdate,
  requestId: string,
  context: string,
  options: {
    expectedLastQueuedAt?: Date | null
    /**
     * Set at call sites that can transition the row to `disabled`. Presence both
     * opts the site into the auto-disable email and adds a `status <> 'disabled'`
     * guard, so the transition fires exactly once per disable.
     */
    disableReason?: ScheduleDisableReason
    /** Required inside a transaction, where mail must wait for commit. */
    deferNotification?: boolean
    /** Join a caller's transaction instead of using the pooled client. */
    executor?: DbOrTx
  } = {}
): Promise<ScheduleUpdateOutcome> {
  let outcome: ScheduleUpdateOutcome

  try {
    const claimGuard =
      options.expectedLastQueuedAt === undefined
        ? undefined
        : options.expectedLastQueuedAt === null
          ? isNull(workflowSchedule.lastQueuedAt)
          : eq(workflowSchedule.lastQueuedAt, options.expectedLastQueuedAt)

    // Terminal means terminal: a completed row is never moved back to active
    // with a fresh nextRunAt. The claim guard does not cover this on its own,
    // because reaching 'completed' does not touch lastQueuedAt.
    const notCompletedGuard = ne(workflowSchedule.status, 'completed')

    /**
     * `RETURNING` yields the NEW row, so `status === 'disabled'` alone only means
     * "is disabled". Excluding rows that were already disabled makes a returned
     * row a true `active -> disabled` edge. Scoped to disable-capable call sites
     * so lock releases on already-disabled rows still work.
     */
    const notAlreadyDisabled = options.disableReason
      ? ne(workflowSchedule.status, 'disabled')
      : undefined

    const updatedRows = await (options.executor ?? db)
      .update(workflowSchedule)
      .set(updates)
      .where(
        and(
          eq(workflowSchedule.id, scheduleId),
          isNull(workflowSchedule.archivedAt),
          claimGuard,
          notCompletedGuard,
          notAlreadyDisabled
        )
      )
      .returning({ id: workflowSchedule.id, status: workflowSchedule.status })

    const row = updatedRows[0]
    outcome = { updated: Boolean(row), status: row?.status ?? null }
  } catch (error) {
    logger.error(`[${requestId}] ${context}`, error, { cause: describeError(error) })
    throw error
  }

  // Outside the try: a mail failure must never surface as a schedule-tick fault.
  if (options.disableReason && !options.deferNotification && outcome.status === 'disabled') {
    await notifyScheduleAutoDisabled({
      scheduleId,
      reason: options.disableReason,
      requestId,
    })
  }

  return outcome
}

export async function releaseScheduleLock(
  scheduleId: string,
  requestId: string,
  now: Date,
  context: string,
  nextRunAt?: Date | null,
  options: { expectedLastQueuedAt?: Date | null } = {}
): Promise<boolean> {
  const updates: WorkflowScheduleUpdate = {
    updatedAt: now,
    lastQueuedAt: null,
  }

  if (nextRunAt) {
    updates.nextRunAt = nextRunAt
  }

  const outcome = await applyScheduleUpdate(scheduleId, updates, requestId, context, options)
  return outcome.updated
}

/** Applies successful-run accounting only while the caller still owns the claim. */
export async function applyScheduleSuccessUpdate(params: {
  scheduleId: string
  now: Date
  nextRunAt: Date
  expectedLastQueuedAt: Date | null
  requestId: string
  context: string
  executor?: DbOrTx
}): Promise<boolean> {
  const { scheduleId, now, nextRunAt, expectedLastQueuedAt, requestId, context, executor } = params

  const outcome = await applyScheduleUpdate(
    scheduleId,
    buildScheduleSuccessUpdate(now, nextRunAt),
    requestId,
    context,
    { expectedLastQueuedAt, executor }
  )

  return outcome.updated
}

/** Applies cancelled-run accounting only while the caller still owns the claim. */
export async function applyScheduleCancellationUpdate(params: {
  scheduleId: string
  now: Date
  nextRunAt: Date
  expectedLastQueuedAt: Date | null
  requestId: string
  context: string
  executor?: DbOrTx
}): Promise<boolean> {
  const { scheduleId, now, nextRunAt, expectedLastQueuedAt, requestId, context, executor } = params

  const outcome = await applyScheduleUpdate(
    scheduleId,
    buildScheduleCancellationUpdate(now, nextRunAt),
    requestId,
    context,
    { expectedLastQueuedAt, executor }
  )

  return outcome.updated
}

/**
 * Applies {@link buildScheduleFailureUpdate} through the same guarded write the
 * trigger.dev path uses, and reports whether the row just transitioned to
 * `disabled`. Callers own the notification so an in-transaction caller can defer
 * it until after commit.
 */
export async function applyScheduleFailureUpdate(params: {
  scheduleId: string
  now: Date
  nextRunAt: Date | null
  expectedLastQueuedAt: Date
  requestId: string
  context: string
  executor?: DbOrTx
}): Promise<{ updated: boolean; disabled: boolean }> {
  const { scheduleId, now, nextRunAt, expectedLastQueuedAt, requestId, context, executor } = params

  const outcome = await applyScheduleUpdate(
    scheduleId,
    buildScheduleFailureUpdate(now, nextRunAt),
    requestId,
    context,
    {
      expectedLastQueuedAt,
      disableReason: 'consecutive_failures',
      deferNotification: true,
      executor,
    }
  )

  return { updated: outcome.updated, disabled: outcome.status === 'disabled' }
}

function getScheduleClaimedAt(payload: ScheduleExecutionPayload): Date | null {
  const claimedAt = new Date(payload.now)
  return Number.isNaN(claimedAt.getTime()) ? null : claimedAt
}

async function retryScheduleAfterInfraFailure({
  payload,
  requestId,
  claimedAt,
  error,
  message,
  cause,
}: {
  payload: ScheduleExecutionPayload
  requestId: string
  claimedAt: Date | null
  error?: unknown
  message?: string
  cause?: Record<string, unknown>
}) {
  const now = new Date()
  const retryAttempt = (payload.infraRetryCount || 0) + 1
  if (retryAttempt > SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS) {
    logger.error(`[${requestId}] Retryable infrastructure failures exhausted for schedule`, {
      scheduleId: payload.scheduleId,
      workflowId: payload.workflowId,
      retryAttempt,
      maxAttempts: SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS,
      cause: cause ?? describeRetryableInfrastructureError(error),
    })

    const nextRunAt = await determineNextRunAfterError(payload, now, requestId)
    await applyScheduleUpdate(
      payload.scheduleId,
      buildScheduleFailureUpdate(now, nextRunAt),
      requestId,
      `Error updating schedule ${payload.scheduleId} after exhausted infrastructure retries`,
      { expectedLastQueuedAt: claimedAt, disableReason: 'consecutive_failures' }
    )
    return
  }

  const retryDelayMs = calculateScheduleInfraRetryDelayMs(retryAttempt)
  const nextRetryAt = new Date(now.getTime() + retryDelayMs)
  const failureCause = cause ?? describeRetryableInfrastructureError(error)
  const errorMessage = message ?? (error ? toError(error).message : undefined)

  logger.warn(`[${requestId}] Retryable infrastructure failure during scheduled setup`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    retryAttempt,
    error: errorMessage,
    retryDelayMs,
    nextRetryAt: nextRetryAt.toISOString(),
    cause: failureCause,
  })

  await applyScheduleUpdate(
    payload.scheduleId,
    {
      updatedAt: now,
      nextRunAt: nextRetryAt,
      lastQueuedAt: null,
      infraRetryCount: retryAttempt,
    },
    requestId,
    `Error updating schedule ${payload.scheduleId} after retryable infrastructure failure`,
    { expectedLastQueuedAt: claimedAt }
  )
}

async function calculateNextRunFromDeployment(
  payload: ScheduleExecutionPayload,
  requestId: string
) {
  try {
    const deployedData = await loadDeployedWorkflowState(payload.workflowId)
    return calculateNextRunTime(payload, deployedData.blocks as Record<string, BlockState>)
  } catch (error) {
    logger.warn(
      `[${requestId}] Unable to calculate nextRunAt for schedule ${payload.scheduleId}`,
      error
    )
    return null
  }
}

async function determineNextRunAfterError(
  payload: ScheduleExecutionPayload,
  now: Date,
  requestId: string
) {
  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (workflowRecord?.isDeployed) {
      const nextRunAt = await calculateNextRunFromDeployment(payload, requestId)
      if (nextRunAt) {
        return nextRunAt
      }
    }
  } catch (workflowError) {
    logger.error(`[${requestId}] Error retrieving workflow for next run calculation`, workflowError)
  }

  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}

async function isScheduleDeploymentVersionActive(
  workflowId: string,
  deploymentVersionId: string
): Promise<boolean> {
  const [activeDeployment] = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.id, deploymentVersionId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)

  return Boolean(activeDeployment)
}

async function isScheduleClaimCurrent(
  scheduleId: string,
  claimedAt: Date | null,
  deploymentOperationId?: string
): Promise<boolean> {
  if (!claimedAt && !deploymentOperationId) return true

  const [scheduleRecord] = await db
    .select({
      lastQueuedAt: workflowSchedule.lastQueuedAt,
      deploymentOperationId: workflowSchedule.deploymentOperationId,
    })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  if (!scheduleRecord) return false
  if (claimedAt && scheduleRecord.lastQueuedAt?.getTime() !== claimedAt.getTime()) return false
  return scheduleRecord.deploymentOperationId === (deploymentOperationId ?? null)
}

async function runWorkflowExecution({
  payload,
  correlation,
  workflowRecord,
  actorUserId,
  billingAttribution,
  loggingSession,
  requestId,
  executionId,
  timeoutController,
}: {
  payload: ScheduleExecutionPayload
  correlation: AsyncExecutionCorrelation
  workflowRecord: WorkflowRecord
  actorUserId: string
  billingAttribution: BillingAttributionSnapshot
  loggingSession: LoggingSession
  requestId: string
  executionId: string
  timeoutController: ReturnType<typeof createTimeoutAbortController>
}): Promise<RunWorkflowResult> {
  let workflowCoreStarted = false
  try {
    const deployedData = await loadDeployedWorkflowState(
      payload.workflowId,
      workflowRecord.workspaceId ?? undefined
    )

    const blocks = deployedData.blocks
    const { deploymentVersionId } = deployedData
    if (payload.deploymentVersionId && deploymentVersionId !== payload.deploymentVersionId) {
      logger.info(`[${requestId}] Loaded deployment no longer matches queued schedule, skipping`, {
        scheduleId: payload.scheduleId,
        workflowId: payload.workflowId,
        queuedDeploymentVersionId: payload.deploymentVersionId,
        loadedDeploymentVersionId: deploymentVersionId,
      })
      return {
        status: 'skip',
        reason: 'stale_deployment',
        blocks: {} as Record<string, BlockState>,
      }
    }
    logger.info(`[${requestId}] Loaded deployed workflow ${payload.workflowId}`)

    if (payload.blockId) {
      if (!blocks[payload.blockId]) {
        logger.warn(
          `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Skipping execution.`
        )

        return {
          status: 'skip',
          reason: 'invalid_schedule',
          blocks: {} as Record<string, BlockState>,
        }
      }
    }

    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      throw new Error(`Workflow ${payload.workflowId} has no associated workspace`)
    }

    const input = {
      _context: {
        workflowId: payload.workflowId,
      },
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId: payload.workflowId,
      workspaceId,
      userId: actorUserId,
      billingAttribution,
      sessionUserId: undefined,
      workflowUserId: workflowRecord.userId,
      triggerType: 'schedule',
      triggerBlockId: payload.blockId || undefined,
      useDraftState: false,
      workflowStateOverride: {
        blocks: deployedData.blocks,
        edges: deployedData.edges,
        loops: deployedData.loops,
        parallels: deployedData.parallels,
        deploymentVersionId,
      },
      startTime: new Date().toISOString(),
      isClientSession: false,
      correlation,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflowRecord,
      input,
      workflowRecord.variables || {},
      []
    )

    let executionResult
    if (
      payload.deploymentVersionId &&
      !(await isScheduleDeploymentVersionActive(payload.workflowId, payload.deploymentVersionId))
    ) {
      logger.info(`[${requestId}] Schedule deployment changed before execution, skipping`, {
        scheduleId: payload.scheduleId,
        workflowId: payload.workflowId,
        deploymentVersionId: payload.deploymentVersionId,
      })
      return {
        status: 'skip',
        reason: 'stale_deployment',
        blocks: {} as Record<string, BlockState>,
      }
    }

    const claimedAt = getScheduleClaimedAt(payload)
    if (
      !(await isScheduleClaimCurrent(payload.scheduleId, claimedAt, payload.deploymentOperationId))
    ) {
      logger.info(`[${requestId}] Schedule claim changed before workflow core started, skipping`, {
        scheduleId: payload.scheduleId,
        workflowId: payload.workflowId,
        claimedAt: claimedAt?.toISOString(),
      })
      return {
        status: 'skip',
        reason: 'stale_claim',
        blocks: {} as Record<string, BlockState>,
      }
    }

    workflowCoreStarted = true
    executionResult = await executeWorkflowCore({
      snapshot,
      callbacks: {},
      loggingSession,
      includeFileBase64: true,
      base64MaxBytes: undefined,
      abortSignal: timeoutController.signal,
    })

    const timeoutMs = timeoutController.timeoutMs
    const timedOut =
      executionResult.status === 'cancelled' &&
      timeoutController.isTimedOut() &&
      timeoutMs !== undefined
    if (timedOut) {
      const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutMs)
      logger.info(`[${requestId}] Scheduled workflow execution timed out`, {
        timeoutMs,
      })
      await loggingSession.markAsFailed(timeoutErrorMessage)
    } else {
      await handlePostExecutionPauseState({
        result: executionResult,
        workflowId: payload.workflowId,
        executionId,
        loggingSession,
      })
    }

    await loggingSession.waitForPostExecution()

    const [persistedExecution] = await db
      .select({ status: workflowExecutionLogs.status })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.executionId, executionId),
          eq(workflowExecutionLogs.workflowId, payload.workflowId)
        )
      )
      .limit(1)

    logger.info(`[${requestId}] Workflow execution completed: ${payload.workflowId}`, {
      success: executionResult.success,
      executionTime: executionResult.metadata?.duration,
    })

    return {
      status: classifyScheduleExecutionResult(
        executionResult,
        timedOut,
        persistedExecution?.status
      ),
      blocks,
      executionResult,
    }
  } catch (error: unknown) {
    if (!workflowCoreStarted && isRetryableInfrastructureError(error)) {
      const cause = describeRetryableInfrastructureError(error)
      logger.warn(`[${requestId}] Retryable setup failure before scheduled workflow started`, {
        scheduleId: payload.scheduleId,
        workflowId: payload.workflowId,
        cause,
      })
      return {
        status: 'retryable_setup_failure',
        error,
        cause,
      }
    }

    if (wasExecutionFinalizedByCore(error, executionId)) {
      throw error
    }

    const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      error: {
        message: toError(error).message,
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      traceSpans,
      executionState: executionResult?.executionState,
    })

    throw error
  } finally {
    void cleanupExecutionBase64Cache(executionId)
  }
}

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  workspaceId: string
  billingAttribution: BillingAttributionSnapshot
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  blockId?: string
  deploymentVersionId?: string
  deploymentOperationId?: string
  cronExpression?: string
  timezone?: string
  lastRanAt?: string
  failedCount?: number
  infraRetryCount?: number
  now: string
  scheduledFor?: string
  /** Trusted attempt budget resolved before the schedule enters the queue. */
  executionTimeoutMs?: number
}

function calculateNextRunTime(
  schedule: { cronExpression?: string; lastRanAt?: string },
  blocks: Record<string, BlockState>
): Date {
  const scheduleBlock = Object.values(blocks).find(
    (block) => block.type === 'starter' || block.type === 'schedule'
  )
  if (!scheduleBlock) throw new Error('No starter or schedule block found')
  const scheduleType = getSubBlockValue(scheduleBlock, 'scheduleType')
  const scheduleValues = getScheduleTimeValues(scheduleBlock)

  const timezone = scheduleValues.timezone || 'UTC'

  if (schedule.cronExpression) {
    const cron = new Cron(schedule.cronExpression, {
      timezone,
    })
    const nextDate = cron.nextRun()
    if (!nextDate) throw new Error('Invalid cron expression or no future occurrences')
    return nextDate
  }

  return calculateNextTime(scheduleType, scheduleValues)
}

export async function executeScheduleJob(
  payload: ScheduleExecutionPayload,
  externalAbortSignal?: AbortSignal
) {
  const payloadBillingAttribution = assertBillingAttributionSnapshot(payload.billingAttribution)
  if (payloadBillingAttribution.workspaceId !== payload.workspaceId) {
    throw new Error('Schedule job billing attribution does not match its workspace')
  }
  const timeoutController = createTimeoutAbortController(
    capExecutionTimeoutMs(
      getAsyncExecutionTimeoutForBillingAttribution(payloadBillingAttribution),
      payload.executionTimeoutMs
    ),
    externalAbortSignal
  )
  const correlation = buildScheduleCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId
  const claimedAt = getScheduleClaimedAt(payload)
  const now = new Date()
  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null

  try {
    return await runWithRequestContext({ requestId }, async () => {
      logger.info(`[${requestId}] Starting schedule execution`, {
        scheduleId: payload.scheduleId,
        workflowId: payload.workflowId,
        executionId,
        scheduledFor: scheduledFor?.toISOString(),
        claimedAt: claimedAt?.toISOString(),
      })

      const releaseClaim = (
        releaseNow: Date,
        context: string,
        nextRunAt?: Date | null
      ): Promise<boolean> =>
        releaseScheduleLock(payload.scheduleId, requestId, releaseNow, context, nextRunAt, {
          expectedLastQueuedAt: claimedAt,
        })

      const updateClaimedSchedule = (
        updates: WorkflowScheduleUpdate,
        context: string,
        disableReason?: ScheduleDisableReason
      ): Promise<ScheduleUpdateOutcome> =>
        applyScheduleUpdate(payload.scheduleId, updates, requestId, context, {
          expectedLastQueuedAt: claimedAt,
          disableReason,
        })

      try {
        const [scheduleRecord] = await db
          .select({
            id: workflowSchedule.id,
            workflowId: workflowSchedule.workflowId,
            deploymentVersionId: workflowSchedule.deploymentVersionId,
            status: workflowSchedule.status,
            archivedAt: workflowSchedule.archivedAt,
            lastQueuedAt: workflowSchedule.lastQueuedAt,
          })
          .from(workflowSchedule)
          .where(eq(workflowSchedule.id, payload.scheduleId))
          .limit(1)

        if (!scheduleRecord) {
          logger.info(`[${requestId}] Schedule no longer exists, skipping execution`, {
            scheduleId: payload.scheduleId,
          })
          return
        }

        if (
          claimedAt &&
          (!scheduleRecord.lastQueuedAt ||
            scheduleRecord.lastQueuedAt.getTime() !== claimedAt.getTime())
        ) {
          logger.info(
            `[${requestId}] Schedule claim no longer matches payload, skipping execution`,
            {
              scheduleId: payload.scheduleId,
              claimedAt: claimedAt.toISOString(),
              currentLastQueuedAt: scheduleRecord.lastQueuedAt?.toISOString(),
            }
          )
          return
        }

        if (scheduleRecord.archivedAt || scheduleRecord.status === 'disabled') {
          logger.info(`[${requestId}] Schedule is archived or disabled, skipping execution`, {
            scheduleId: payload.scheduleId,
          })
          await releaseClaim(
            now,
            `Failed to release schedule ${payload.scheduleId} after archive/disabled check`
          )
          return
        }

        const expectedDeploymentVersionId =
          payload.deploymentVersionId ?? scheduleRecord.deploymentVersionId ?? undefined
        if (expectedDeploymentVersionId) {
          const [activeDeployment] = await db
            .select({ id: workflowDeploymentVersion.id })
            .from(workflowDeploymentVersion)
            .where(
              and(
                eq(workflowDeploymentVersion.workflowId, payload.workflowId),
                eq(workflowDeploymentVersion.id, expectedDeploymentVersionId),
                eq(workflowDeploymentVersion.isActive, true)
              )
            )
            .limit(1)

          if (!activeDeployment) {
            logger.info(
              `[${requestId}] Schedule deployment version is no longer active, skipping`,
              {
                scheduleId: payload.scheduleId,
                workflowId: payload.workflowId,
                deploymentVersionId: expectedDeploymentVersionId,
              }
            )
            await releaseClaim(
              now,
              `Failed to release stale deployment schedule ${payload.scheduleId}`
            )
            return
          }
        }

        const loggingSession = new LoggingSession(
          payload.workflowId,
          executionId,
          'schedule',
          requestId
        )
        loggingSession.setExecutionDeadlineAt(getExecutionDeadlineAt(timeoutController.signal))

        const preprocessResult = await preprocessExecution({
          workflowId: payload.workflowId,
          userId: 'unknown', // Will be resolved from workflow record
          triggerType: 'schedule',
          executionId,
          requestId,
          checkRateLimit: true,
          checkDeployment: true,
          loggingSession,
          triggerData: { correlation },
          billingAttribution: payloadBillingAttribution,
          executionType: 'async',
          executionDeadlineAt: getExecutionDeadlineAt(timeoutController.signal)?.getTime(),
        })

        if (!preprocessResult.success) {
          const preprocessingError = preprocessResult.error
          const statusCode = preprocessingError.statusCode
          const transientAdmissionFailure = classifyTransientAdmissionFailure(preprocessingError)

          if (transientAdmissionFailure) {
            await retryScheduleAfterInfraFailure({
              payload,
              requestId,
              claimedAt,
              message: preprocessingError.message,
              cause: preprocessingError.cause,
            })
            return
          }

          switch (statusCode) {
            case 401: {
              logger.warn(
                `[${requestId}] Authentication error during preprocessing, disabling schedule`
              )
              await updateClaimedSchedule(
                {
                  updatedAt: now,
                  lastQueuedAt: null,
                  lastFailedAt: now,
                  status: 'disabled',
                  ...resetScheduleInfraRetryCount(),
                },
                `Failed to disable schedule ${payload.scheduleId} after authentication error`,
                'authentication_error'
              )
              return
            }

            case 403: {
              logger.warn(
                `[${requestId}] Authorization error during preprocessing, disabling schedule: ${preprocessingError.message}`
              )
              await updateClaimedSchedule(
                {
                  updatedAt: now,
                  lastQueuedAt: null,
                  lastFailedAt: now,
                  status: 'disabled',
                  ...resetScheduleInfraRetryCount(),
                },
                `Failed to disable schedule ${payload.scheduleId} after authorization error`,
                'authorization_error'
              )
              return
            }

            case 404: {
              logger.warn(`[${requestId}] Workflow not found, disabling schedule`)
              await updateClaimedSchedule(
                {
                  updatedAt: now,
                  lastQueuedAt: null,
                  status: 'disabled',
                  ...resetScheduleInfraRetryCount(),
                },
                `Failed to disable schedule ${payload.scheduleId} after missing workflow`,
                'workflow_not_found'
              )
              return
            }

            case 429: {
              logger.warn(`[${requestId}] Rate limit exceeded, scheduling retry`)
              const retryDelay = 5 * 60 * 1000
              const nextRetryAt = new Date(now.getTime() + retryDelay)

              await updateClaimedSchedule(
                {
                  updatedAt: now,
                  nextRunAt: nextRetryAt,
                  lastQueuedAt: null,
                  ...resetScheduleInfraRetryCount(),
                },
                `Error updating schedule ${payload.scheduleId} for rate limit`
              )
              return
            }

            case 402: {
              /**
               * Usage limits are a billing state, not a broken workflow, but they only
               * clear on billing-period rollover or upgrade. Keep retrying at the normal
               * cadence, but count each hit toward the shared auto-disable threshold so an
               * abandoned over-limit schedule eventually stops instead of running forever.
               * A successful run resets failedCount, so transient overages self-heal.
               */
              const nextRunAt =
                (await calculateNextRunFromDeployment(payload, requestId)) ??
                new Date(now.getTime() + 60 * 60 * 1000)
              logger.warn(`[${requestId}] Usage limit exceeded, counting as failed run`, {
                scheduleId: payload.scheduleId,
                nextRunAt: nextRunAt.toISOString(),
              })
              await updateClaimedSchedule(
                buildScheduleFailureUpdate(now, nextRunAt),
                `Error updating schedule ${payload.scheduleId} after usage limit check`,
                'consecutive_failures'
              )
              return
            }

            default: {
              if (statusCode >= 500 && preprocessingError.retryable) {
                await retryScheduleAfterInfraFailure({
                  payload,
                  requestId,
                  claimedAt,
                  message: preprocessingError.message,
                  cause: preprocessingError.cause,
                })
                return
              }

              logger.error(`[${requestId}] Preprocessing failed: ${preprocessingError.message}`)
              const nextRunAt = await determineNextRunAfterError(payload, now, requestId)

              await updateClaimedSchedule(
                buildScheduleFailureUpdate(now, nextRunAt),
                `Error updating schedule ${payload.scheduleId} after preprocessing failure`,
                'consecutive_failures'
              )
              return
            }
          }
        }

        const { actorUserId, billingAttribution, workflowRecord } = preprocessResult
        if (!actorUserId || !billingAttribution || !workflowRecord) {
          logger.error(`[${requestId}] Missing required preprocessing data`)
          await releaseClaim(
            now,
            `Failed to release schedule ${payload.scheduleId} after missing preprocessing data`
          )
          return
        }

        if (!workflowRecord.workspaceId) {
          throw new Error(`Workflow ${payload.workflowId} has no associated workspace`)
        }

        logger.info(`[${requestId}] Executing scheduled workflow ${payload.workflowId}`)

        try {
          const executionResult = await runWorkflowExecution({
            payload,
            correlation,
            workflowRecord,
            actorUserId,
            billingAttribution,
            loggingSession,
            requestId,
            executionId,
            timeoutController,
          })

          if (executionResult.status === 'retryable_setup_failure') {
            await retryScheduleAfterInfraFailure({
              payload,
              requestId,
              claimedAt,
              error: executionResult.error,
              cause: executionResult.cause,
            })
            return
          }

          if (executionResult.status === 'skip') {
            if (executionResult.reason === 'stale_deployment') {
              await releaseClaim(
                now,
                `Failed to release stale schedule ${payload.scheduleId} after deployment version changed`
              )
              return
            }
            if (executionResult.reason === 'stale_claim') {
              return
            }

            await updateClaimedSchedule(
              {
                updatedAt: now,
                lastQueuedAt: null,
                lastFailedAt: now,
                status: 'disabled',
                nextRunAt: null,
                ...resetScheduleInfraRetryCount(),
              },
              `Failed to disable schedule ${payload.scheduleId} after skip`,
              'invalid_schedule'
            )
            return
          }

          if (executionResult.status === 'success') {
            logger.info(`[${requestId}] Workflow ${payload.workflowId} executed successfully`)

            const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)

            await updateClaimedSchedule(
              buildScheduleSuccessUpdate(now, nextRunAt),
              `Error updating schedule ${payload.scheduleId} after success`
            )
            return
          }

          if (executionResult.status === 'cancelled') {
            logger.info(`[${requestId}] Workflow ${payload.workflowId} execution was cancelled`)

            const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)
            await updateClaimedSchedule(
              buildScheduleCancellationUpdate(now, nextRunAt),
              `Error updating schedule ${payload.scheduleId} after cancellation`
            )
            return
          }

          logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)

          const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)

          await updateClaimedSchedule(
            buildScheduleFailureUpdate(now, nextRunAt),
            `Error updating schedule ${payload.scheduleId} after failure`,
            'consecutive_failures'
          )
        } catch (error: unknown) {
          logger.error(
            `[${requestId}] Error executing scheduled workflow ${payload.workflowId}`,
            loggingSession.projectDiagnosticError(error)
          )

          const nextRunAt = await determineNextRunAfterError(payload, now, requestId)

          await updateClaimedSchedule(
            buildScheduleFailureUpdate(now, nextRunAt),
            `Error updating schedule ${payload.scheduleId} after execution error`,
            'consecutive_failures'
          )
        }
      } catch (error: unknown) {
        try {
          if (isRetryableInfrastructureError(error)) {
            await retryScheduleAfterInfraFailure({ payload, requestId, claimedAt, error })
            return
          }

          logger.error(`[${requestId}] Error processing schedule ${payload.scheduleId}`, error, {
            cause: describeError(error),
          })
          await releaseClaim(
            now,
            `Failed to release schedule ${payload.scheduleId} after unhandled error`
          )
        } catch (recoveryError: unknown) {
          // A secondary failure during error recovery (e.g. a transient DB blip while
          // releasing the claim or scheduling an infra retry) must not fault the run. The
          // claim expires on its TTL and the next tick re-claims the schedule. Record the
          // exception on the span so it stays visible in traces without faulting the run.
          logger.error(
            `[${requestId}] Failed to recover schedule ${payload.scheduleId} after error`,
            recoveryError
          )
          trace.getActiveSpan()?.recordException(toError(recoveryError))
        }
      }
    })
  } finally {
    timeoutController.cleanup()
  }
}

export const scheduleExecutionTaskOptions = {
  id: 'schedule-execution',
  maxDuration: timeout.None,
  machine: 'medium-2x' as const,
  retry: {
    maxAttempts: 1,
  },
  queue: {
    name: SCHEDULE_EXECUTION_QUEUE_NAME,
    concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  },
  run: async (payload: ScheduleExecutionPayload, { signal }: { signal: AbortSignal }) =>
    executeScheduleJob(payload, signal),
}

export const scheduleExecution = task(scheduleExecutionTaskOptions)
