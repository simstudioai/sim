import { trace } from '@opentelemetry/api'
import {
  db,
  jobExecutionLogs,
  workflow,
  workflowDeploymentVersion,
  workflowSchedule,
} from '@sim/db'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { task } from '@trigger.dev/sdk'
import { Cron } from 'croner'
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import {
  describeRetryableInfrastructureError,
  isRetryableInfrastructureError,
} from '@/lib/core/errors/retryable-infrastructure'
import {
  createTimeoutAbortController,
  getExecutionTimeout,
  getTimeoutErrorMessage,
} from '@/lib/core/execution-limits'
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
import {
  SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  SCHEDULE_EXECUTION_QUEUE_NAME,
  SCHEDULE_INFRA_RETRY_BASE_MS,
  SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS,
  SCHEDULE_INFRA_RETRY_MAX_MS,
} from '@/lib/workflows/schedules/execution-limits'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
  validateCronExpression,
} from '@/lib/workflows/schedules/utils'
import { getWorkspaceById } from '@/lib/workspaces/permissions/utils'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { buildAPIUrl, buildAuthHeaders } from '@/executor/utils/http'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('ScheduleExecution')

type WorkflowRecord = typeof workflow.$inferSelect
type WorkflowScheduleInsert = typeof workflowSchedule.$inferInsert
type WorkflowScheduleUpdate = Partial<Omit<WorkflowScheduleInsert, 'failedCount' | 'status'>> & {
  failedCount?: WorkflowScheduleInsert['failedCount'] | SQL
  status?: WorkflowScheduleInsert['status'] | SQL
}
type ExecutionCoreResult = Awaited<ReturnType<typeof executeWorkflowCore>>

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

async function applyScheduleUpdate(
  scheduleId: string,
  updates: WorkflowScheduleUpdate,
  requestId: string,
  context: string,
  options: { expectedLastQueuedAt?: Date | null } = {}
): Promise<boolean> {
  try {
    const claimGuard =
      options.expectedLastQueuedAt === undefined
        ? undefined
        : options.expectedLastQueuedAt === null
          ? isNull(workflowSchedule.lastQueuedAt)
          : eq(workflowSchedule.lastQueuedAt, options.expectedLastQueuedAt)

    const updatedRows = await db
      .update(workflowSchedule)
      .set(updates)
      .where(
        and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt), claimGuard)
      )
      .returning({ id: workflowSchedule.id })

    return updatedRows.length > 0
  } catch (error) {
    logger.error(`[${requestId}] ${context}`, error, { cause: describeError(error) })
    throw error
  }
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

  return applyScheduleUpdate(scheduleId, updates, requestId, context, options)
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
      { expectedLastQueuedAt: claimedAt }
    )
    return
  }

  const retryDelayMs = Math.min(
    SCHEDULE_INFRA_RETRY_MAX_MS,
    Math.round(
      backoffWithJitter(retryAttempt, null, {
        baseMs: SCHEDULE_INFRA_RETRY_BASE_MS,
        maxMs: SCHEDULE_INFRA_RETRY_MAX_MS,
      })
    )
  )
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
  claimedAt: Date | null
): Promise<boolean> {
  if (!claimedAt) return true

  const [scheduleRecord] = await db
    .select({ lastQueuedAt: workflowSchedule.lastQueuedAt })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  return scheduleRecord?.lastQueuedAt?.getTime() === claimedAt.getTime()
}

async function runWorkflowExecution({
  payload,
  correlation,
  workflowRecord,
  actorUserId,
  loggingSession,
  requestId,
  executionId,
  asyncTimeout,
}: {
  payload: ScheduleExecutionPayload
  correlation: AsyncExecutionCorrelation
  workflowRecord: WorkflowRecord
  actorUserId: string
  loggingSession: LoggingSession
  requestId: string
  executionId: string
  asyncTimeout?: number
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

    const timeoutController = createTimeoutAbortController(asyncTimeout)

    let executionResult
    try {
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
      if (!(await isScheduleClaimCurrent(payload.scheduleId, claimedAt))) {
        logger.info(
          `[${requestId}] Schedule claim changed before workflow core started, skipping`,
          {
            scheduleId: payload.scheduleId,
            workflowId: payload.workflowId,
            claimedAt: claimedAt?.toISOString(),
          }
        )
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
    } finally {
      timeoutController.cleanup()
    }

    if (
      executionResult.status === 'cancelled' &&
      timeoutController.isTimedOut() &&
      timeoutController.timeoutMs
    ) {
      const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
      logger.info(`[${requestId}] Scheduled workflow execution timed out`, {
        timeoutMs: timeoutController.timeoutMs,
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

    logger.info(`[${requestId}] Workflow execution completed: ${payload.workflowId}`, {
      success: executionResult.success,
      executionTime: executionResult.metadata?.duration,
    })

    if (executionResult.success) {
      return { status: 'success', blocks, executionResult }
    }

    return { status: 'failure', blocks, executionResult }
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

    logger.error(
      `[${requestId}] Early failure in scheduled workflow ${payload.workflowId}`,
      error,
      {
        cause: describeError(error),
      }
    )

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
    })

    throw error
  } finally {
    void cleanupExecutionBase64Cache(executionId)
  }
}

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  workspaceId?: string
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  blockId?: string
  deploymentVersionId?: string
  cronExpression?: string
  timezone?: string
  lastRanAt?: string
  failedCount?: number
  infraRetryCount?: number
  now: string
  scheduledFor?: string
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

export async function executeScheduleJob(payload: ScheduleExecutionPayload) {
  const correlation = buildScheduleCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId
  const claimedAt = getScheduleClaimedAt(payload)
  const now = new Date()
  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null

  return runWithRequestContext({ requestId }, async () => {
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
      context: string
    ): Promise<boolean> =>
      applyScheduleUpdate(payload.scheduleId, updates, requestId, context, {
        expectedLastQueuedAt: claimedAt,
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
        logger.info(`[${requestId}] Schedule claim no longer matches payload, skipping execution`, {
          scheduleId: payload.scheduleId,
          claimedAt: claimedAt.toISOString(),
          currentLastQueuedAt: scheduleRecord.lastQueuedAt?.toISOString(),
        })
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
          logger.info(`[${requestId}] Schedule deployment version is no longer active, skipping`, {
            scheduleId: payload.scheduleId,
            workflowId: payload.workflowId,
            deploymentVersionId: expectedDeploymentVersionId,
          })
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
      })

      if (!preprocessResult.success) {
        const statusCode = preprocessResult.error?.statusCode || 500

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
              `Failed to disable schedule ${payload.scheduleId} after authentication error`
            )
            return
          }

          case 403: {
            logger.warn(
              `[${requestId}] Authorization error during preprocessing, disabling schedule: ${preprocessResult.error?.message}`
            )
            await updateClaimedSchedule(
              {
                updatedAt: now,
                lastQueuedAt: null,
                lastFailedAt: now,
                status: 'disabled',
                ...resetScheduleInfraRetryCount(),
              },
              `Failed to disable schedule ${payload.scheduleId} after authorization error`
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
              `Failed to disable schedule ${payload.scheduleId} after missing workflow`
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
              `Error updating schedule ${payload.scheduleId} after usage limit check`
            )
            return
          }

          default: {
            if (statusCode >= 500 && preprocessResult.error?.retryable) {
              await retryScheduleAfterInfraFailure({
                payload,
                requestId,
                claimedAt,
                message: preprocessResult.error.message,
                cause: preprocessResult.error.cause,
              })
              return
            }

            logger.error(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`)
            const nextRunAt = await determineNextRunAfterError(payload, now, requestId)

            await updateClaimedSchedule(
              buildScheduleFailureUpdate(now, nextRunAt),
              `Error updating schedule ${payload.scheduleId} after preprocessing failure`
            )
            return
          }
        }
      }

      const { actorUserId, workflowRecord } = preprocessResult
      if (!actorUserId || !workflowRecord) {
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
          loggingSession,
          requestId,
          executionId,
          asyncTimeout: preprocessResult.executionTimeout?.async,
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
            `Failed to disable schedule ${payload.scheduleId} after skip`
          )
          return
        }

        if (executionResult.status === 'success') {
          logger.info(`[${requestId}] Workflow ${payload.workflowId} executed successfully`)

          const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)

          await updateClaimedSchedule(
            {
              lastRanAt: now,
              updatedAt: now,
              nextRunAt,
              failedCount: 0,
              lastQueuedAt: null,
              ...resetScheduleInfraRetryCount(),
            },
            `Error updating schedule ${payload.scheduleId} after success`
          )
          return
        }

        logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)

        const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)

        await updateClaimedSchedule(
          buildScheduleFailureUpdate(now, nextRunAt),
          `Error updating schedule ${payload.scheduleId} after failure`
        )
      } catch (error: unknown) {
        logger.error(
          `[${requestId}] Error executing scheduled workflow ${payload.workflowId}`,
          error
        )

        const nextRunAt = await determineNextRunAfterError(payload, now, requestId)

        await updateClaimedSchedule(
          buildScheduleFailureUpdate(now, nextRunAt),
          `Error updating schedule ${payload.scheduleId} after execution error`
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
}

export type JobExecutionPayload = {
  scheduleId: string
  cronExpression?: string
  failedCount?: number
  now: string
}

function buildJobPrompt(jobRecord: {
  id: string
  jobTitle: string | null
  prompt: string | null
  lifecycle: string
  successCondition: string | null
  runCount: number
  maxRuns: number | null
  sourceTaskName: string | null
  sourceChatId: string | null
  jobHistory: Array<{ timestamp: string; summary: string }> | null
}): string {
  const parts: string[] = []

  parts.push('--- JOB EXECUTION ---')
  parts.push(`Job ID: ${jobRecord.id}`)
  if (jobRecord.jobTitle) parts.push(`Title: ${jobRecord.jobTitle}`)

  if (jobRecord.lifecycle === 'until_complete') {
    parts.push(`Lifecycle: until_complete`)
    if (jobRecord.successCondition) {
      parts.push(`Success Condition: ${jobRecord.successCondition}`)
    }
    const runDisplay = jobRecord.maxRuns
      ? `${jobRecord.runCount + 1} / ${jobRecord.maxRuns}`
      : `${jobRecord.runCount + 1}`
    parts.push(`Run: ${runDisplay}`)
  }

  parts.push('')
  parts.push('TASK:')
  parts.push(jobRecord.prompt || '')

  if (jobRecord.sourceTaskName) {
    parts.push('')
    parts.push(`RELATED TASK: ${jobRecord.sourceTaskName}`)
  }

  if (jobRecord.sourceChatId) {
    parts.push("Read the task's session.md in the VFS for conversation context.")
  }

  if (jobRecord.jobHistory && jobRecord.jobHistory.length > 0) {
    parts.push('')
    parts.push('PREVIOUS RUN HISTORY (for idempotency -- do NOT reprocess items already handled):')
    const recentHistory = jobRecord.jobHistory.slice(-10)
    for (const entry of recentHistory) {
      parts.push(`- [${entry.timestamp}] ${entry.summary}`)
    }
    parts.push('')
    parts.push(
      'Use this history to avoid duplicate work. After completing meaningful work this run, call update_job_history to record what you did.'
    )
  } else if (jobRecord.runCount > 0) {
    parts.push('')
    parts.push(
      'No previous run history recorded. After completing meaningful work, call update_job_history to record what you did for future runs.'
    )
  } else {
    parts.push('')
    parts.push(
      'This is the first run. After completing meaningful work, call update_job_history to record what you did so future runs have context.'
    )
  }

  if (jobRecord.lifecycle === 'until_complete') {
    parts.push('')
    parts.push('COMPLETION PROTOCOL:')
    parts.push('This is a poll-until-done job. After executing the task above:')
    parts.push(
      `- If the success condition is met, take the required action, then call complete_job(jobId: "${jobRecord.id}") to stop the job.`
    )
    parts.push(
      '- If the success condition is NOT met, do nothing extra. The job will run again on schedule.'
    )
  }

  parts.push('--- END JOB EXECUTION ---')

  return parts.join('\n')
}

async function createJobLogEntry(params: {
  scheduleId: string
  workspaceId: string
  jobTitle: string | null
  startTime: Date
  endTime: Date
  durationMs: number
  success: boolean
  responseBody?: Record<string, any>
  errorMessage?: string
}): Promise<void> {
  try {
    const {
      scheduleId,
      workspaceId,
      jobTitle,
      startTime,
      endTime,
      durationMs,
      success,
      responseBody,
    } = params
    const name = jobTitle || 'Mothership Job'

    const toolCallsList = (responseBody?.toolCalls || []).map((tc: Record<string, unknown>) => ({
      name: tc.name,
      input: tc.params || {},
      output: tc.result
        ? typeof tc.result === 'object'
          ? tc.result
          : { result: tc.result }
        : undefined,
      error: tc.error,
      duration: (tc.durationMs as number) || 0,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      status: tc.error ? 'error' : 'success',
    }))

    const traceSpan = {
      id: generateId(),
      name,
      type: 'mothership',
      duration: durationMs,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      status: success ? 'success' : 'error',
      output: {
        content: responseBody?.content || '',
        model: responseBody?.model || 'mothership',
        tokens: responseBody?.tokens || {},
      },
      toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
      cost: responseBody?.cost || undefined,
      tokens: responseBody?.tokens || undefined,
    }

    await db.insert(jobExecutionLogs).values({
      id: generateId(),
      scheduleId,
      workspaceId,
      executionId: generateId(),
      level: success ? 'info' : 'error',
      status: success ? 'completed' : 'failed',
      trigger: 'mothership',
      startedAt: startTime,
      endedAt: endTime,
      totalDurationMs: durationMs,
      executionData: {
        enhanced: true,
        traceSpans: [traceSpan],
        finalOutput: responseBody?.content ? { content: responseBody.content } : undefined,
        trigger: {
          type: 'mothership',
          source: name,
          timestamp: startTime.toISOString(),
        },
      },
      cost: responseBody?.cost
        ? {
            total: responseBody.cost.total || 0,
            input: responseBody.cost.input || 0,
            output: responseBody.cost.output || 0,
            tokens: responseBody.tokens || {},
          }
        : null,
    })
  } catch (error) {
    logger.error('Failed to create job log entry', {
      error: toError(error).message,
    })
  }
}

export async function executeJobInline(payload: JobExecutionPayload) {
  const requestId = generateId().slice(0, 8)
  const now = new Date(payload.now)

  logger.info(`[${requestId}] Starting job execution`, { scheduleId: payload.scheduleId })

  const [jobRecord] = await db
    .select()
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, payload.scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  if (!jobRecord || !jobRecord.prompt || !jobRecord.sourceUserId || !jobRecord.sourceWorkspaceId) {
    logger.error(`[${requestId}] Job record missing required fields`, {
      scheduleId: payload.scheduleId,
    })
    await releaseScheduleLock(
      payload.scheduleId,
      requestId,
      now,
      `Failed to release job ${payload.scheduleId} after missing fields`,
      undefined,
      { expectedLastQueuedAt: now }
    )
    return
  }

  if (!jobRecord.lastQueuedAt || jobRecord.lastQueuedAt.getTime() !== now.getTime()) {
    logger.info(`[${requestId}] Job claim no longer matches payload, skipping execution`, {
      scheduleId: payload.scheduleId,
      claimedAt: now.toISOString(),
      currentLastQueuedAt: jobRecord.lastQueuedAt?.toISOString(),
    })
    return
  }

  const activeWorkspace = await getWorkspaceById(jobRecord.sourceWorkspaceId)
  if (!activeWorkspace || jobRecord.status === 'disabled') {
    logger.info(`[${requestId}] Job is archived, disabled, or workspace is inactive`, {
      scheduleId: payload.scheduleId,
    })
    await releaseScheduleLock(
      payload.scheduleId,
      requestId,
      now,
      `Failed to release job ${payload.scheduleId} after archive/disabled check`,
      undefined,
      { expectedLastQueuedAt: now }
    )
    return
  }

  if (jobRecord.status === 'completed') {
    logger.info(`[${requestId}] Job already completed, skipping`, {
      scheduleId: payload.scheduleId,
    })
    await releaseScheduleLock(
      payload.scheduleId,
      requestId,
      now,
      `Failed to release job ${payload.scheduleId} after completed skip`,
      undefined,
      { expectedLastQueuedAt: now }
    )
    return
  }

  const promptText = buildJobPrompt(jobRecord)

  try {
    const userSubscription = await getHighestPrioritySubscription(jobRecord.sourceUserId)
    const mothershipJobTimeoutMs = getExecutionTimeout(userSubscription?.plan, 'sync')
    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders(jobRecord.sourceUserId)

    const body = {
      messages: [{ role: 'user', content: promptText }],
      workspaceId: jobRecord.sourceWorkspaceId,
      userId: jobRecord.sourceUserId,
      chatId: jobRecord.sourceChatId || generateId(),
    }

    const startTime = new Date()
    const timeoutController = createTimeoutAbortController(mothershipJobTimeoutMs)
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => {
          if (timeoutController.isTimedOut()) {
            throw new Error(getTimeoutErrorMessage(null, timeoutController.timeoutMs))
          }
          return 'Unknown error'
        })
        const endTime = new Date()
        const durationMs = endTime.getTime() - startTime.getTime()

        await createJobLogEntry({
          scheduleId: payload.scheduleId,
          workspaceId: jobRecord.sourceWorkspaceId,
          jobTitle: jobRecord.jobTitle,
          startTime,
          endTime,
          durationMs,
          success: false,
          errorMessage: errorText,
        })

        throw new Error(`Mothership execution failed (${response.status}): ${errorText}`)
      }

      let responseBody: Record<string, any> = {}
      let wasCompletedByTool = false
      try {
        responseBody = await response.json()
        const toolCalls = responseBody?.toolCalls as Array<{ name?: string }> | undefined
        wasCompletedByTool = toolCalls?.some((tc) => tc.name === 'complete_job') ?? false
      } catch {
        if (timeoutController.isTimedOut()) {
          throw new Error(getTimeoutErrorMessage(null, timeoutController.timeoutMs))
        }
      }
      const endTime = new Date()
      const durationMs = endTime.getTime() - startTime.getTime()

      await createJobLogEntry({
        scheduleId: payload.scheduleId,
        workspaceId: jobRecord.sourceWorkspaceId,
        jobTitle: jobRecord.jobTitle,
        startTime,
        endTime,
        durationMs,
        success: true,
        responseBody,
      })

      const newRunCount = (jobRecord.runCount || 0) + 1

      logger.info(`[${requestId}] Job executed successfully`, {
        scheduleId: payload.scheduleId,
        runCount: newRunCount,
        wasCompletedByTool,
      })

      if (wasCompletedByTool) {
        await applyScheduleUpdate(
          payload.scheduleId,
          {
            lastRanAt: now,
            updatedAt: now,
            runCount: newRunCount,
            failedCount: 0,
            lastQueuedAt: null,
          },
          requestId,
          `Error updating job ${payload.scheduleId} after completion`,
          { expectedLastQueuedAt: now }
        )
        return
      }

      const isOneTime = !jobRecord.cronExpression
      let nextRunAt: Date | null = null

      if (!isOneTime && jobRecord.cronExpression) {
        const validation = validateCronExpression(
          jobRecord.cronExpression,
          jobRecord.timezone || 'UTC'
        )
        nextRunAt = validation.nextRun || null
      }

      const maxRunsReached = jobRecord.maxRuns && newRunCount >= jobRecord.maxRuns
      if (maxRunsReached) {
        logger.info(`[${requestId}] Job hit maxRuns limit`, {
          scheduleId: payload.scheduleId,
          maxRuns: jobRecord.maxRuns,
          runCount: newRunCount,
        })
      }

      await applyScheduleUpdate(
        payload.scheduleId,
        {
          lastRanAt: now,
          updatedAt: now,
          nextRunAt: isOneTime || maxRunsReached ? null : nextRunAt,
          failedCount: 0,
          lastQueuedAt: null,
          runCount: newRunCount,
          status: isOneTime || maxRunsReached ? 'completed' : 'active',
        },
        requestId,
        `Error updating job ${payload.scheduleId} after success`,
        { expectedLastQueuedAt: now }
      )
    } finally {
      timeoutController.cleanup()
    }
  } catch (error) {
    const errorMessage = toError(error).message
    logger.error(`[${requestId}] Job execution failed`, {
      scheduleId: payload.scheduleId,
      error: errorMessage,
    })

    const newFailedCount = (payload.failedCount || 0) + 1
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

    let nextRunAt: Date | null = null
    if (jobRecord.cronExpression) {
      const validation = validateCronExpression(
        jobRecord.cronExpression,
        jobRecord.timezone || 'UTC'
      )
      nextRunAt = validation.nextRun || null
    }

    await applyScheduleUpdate(
      payload.scheduleId,
      {
        updatedAt: now,
        nextRunAt,
        failedCount: newFailedCount,
        lastFailedAt: now,
        lastQueuedAt: null,
        runCount: (jobRecord.runCount || 0) + 1,
        status: shouldDisable ? 'disabled' : 'active',
      },
      requestId,
      `Error updating job ${payload.scheduleId} after failure`,
      { expectedLastQueuedAt: now }
    )
  }
}

export const scheduleExecutionTaskOptions = {
  id: 'schedule-execution',
  machine: 'medium-1x' as const,
  retry: {
    maxAttempts: 1,
  },
  queue: {
    name: SCHEDULE_EXECUTION_QUEUE_NAME,
    concurrencyLimit: SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  },
  run: async (payload: ScheduleExecutionPayload) => executeScheduleJob(payload),
}

export const scheduleExecution = task(scheduleExecutionTaskOptions)
