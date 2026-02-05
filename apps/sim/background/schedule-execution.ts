import { db, workflow, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import {
  blockExistsInDeployment,
  loadDeployedWorkflowState,
} from '@/lib/workflows/persistence/utils'
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

const logger = createLogger('TriggerScheduleExecution')

type WorkflowRecord = typeof workflow.$inferSelect
type WorkflowScheduleUpdate = Partial<typeof workflowSchedule.$inferInsert>
type ExecutionCoreResult = Awaited<ReturnType<typeof executeWorkflowCore>>

type RunWorkflowResult =
  | { status: 'skip'; blocks: Record<string, BlockState> }
  | { status: 'success'; blocks: Record<string, BlockState>; executionResult: ExecutionCoreResult }
  | { status: 'failure'; blocks: Record<string, BlockState>; executionResult: ExecutionCoreResult }

async function applyScheduleUpdate(
  scheduleId: string,
  updates: WorkflowScheduleUpdate,
  requestId: string,
  context: string,
  successLog?: string
) {
  try {
    await db.update(workflowSchedule).set(updates).where(eq(workflowSchedule.id, scheduleId))

    if (successLog) {
      logger.debug(`[${requestId}] ${successLog}`)
    }
  } catch (error) {
    logger.error(`[${requestId}] ${context}`, error)
  }
}

async function releaseScheduleLock(
  scheduleId: string,
  requestId: string,
  now: Date,
  context: string,
  nextRunAt?: Date | null
) {
  const updates: WorkflowScheduleUpdate = {
    updatedAt: now,
    lastQueuedAt: null,
  }

  if (nextRunAt) {
    updates.nextRunAt = nextRunAt
  }

  await applyScheduleUpdate(scheduleId, updates, requestId, context)
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

async function runWorkflowExecution({
  payload,
  workflowRecord,
  actorUserId,
  loggingSession,
  requestId,
  executionId,
  asyncTimeout,
}: {
  payload: ScheduleExecutionPayload
  workflowRecord: WorkflowRecord
  actorUserId: string
  loggingSession: LoggingSession
  requestId: string
  executionId: string
  asyncTimeout?: number
}): Promise<RunWorkflowResult> {
  try {
    logger.debug(`[${requestId}] Loading deployed workflow ${payload.workflowId}`)
    const deployedData = await loadDeployedWorkflowState(payload.workflowId)

    const blocks = deployedData.blocks
    const { deploymentVersionId } = deployedData
    logger.info(`[${requestId}] Loaded deployed workflow ${payload.workflowId}`)

    if (payload.blockId) {
      const blockExists = await blockExistsInDeployment(payload.workflowId, payload.blockId)
      if (!blockExists) {
        logger.warn(
          `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Skipping execution.`
        )

        return { status: 'skip', blocks: {} as Record<string, BlockState> }
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
      startTime: new Date().toISOString(),
      isClientSession: false,
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
    } else if (executionResult.status === 'paused') {
      if (!executionResult.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
        await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
      } else {
        try {
          await PauseResumeManager.persistPauseResult({
            workflowId: payload.workflowId,
            executionId,
            pausePoints: executionResult.pausePoints || [],
            snapshotSeed: executionResult.snapshotSeed,
            executorUserId: executionResult.metadata?.userId,
          })
        } catch (pauseError) {
          logger.error(`[${requestId}] Failed to persist pause result`, {
            executionId,
            error: pauseError instanceof Error ? pauseError.message : String(pauseError),
          })
          await loggingSession.markAsFailed(
            `Failed to persist pause state: ${pauseError instanceof Error ? pauseError.message : String(pauseError)}`
          )
        }
      }
    } else {
      await PauseResumeManager.processQueuedResumes(executionId)
    }

    logger.info(`[${requestId}] Workflow execution completed: ${payload.workflowId}`, {
      success: executionResult.success,
      executionTime: executionResult.metadata?.duration,
    })

    if (executionResult.success) {
      return { status: 'success', blocks, executionResult }
    }

    return { status: 'failure', blocks, executionResult }
  } catch (error: unknown) {
    logger.error(`[${requestId}] Early failure in scheduled workflow ${payload.workflowId}`, error)

    const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      error: {
        message: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      traceSpans,
    })

    throw error
  }
}

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  blockId?: string
  cronExpression?: string
  lastRanAt?: string
  failedCount?: number
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
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)
  const now = new Date(payload.now)
  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  try {
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
    })

    if (!preprocessResult.success) {
      const statusCode = preprocessResult.error?.statusCode || 500

      switch (statusCode) {
        case 401: {
          logger.warn(
            `[${requestId}] Authentication error during preprocessing, disabling schedule`
          )
          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              lastQueuedAt: null,
              lastFailedAt: now,
              status: 'disabled',
            },
            requestId,
            `Failed to disable schedule ${payload.scheduleId} after authentication error`,
            `Disabled schedule ${payload.scheduleId} due to authentication failure (401)`
          )
          return
        }

        case 403: {
          logger.warn(
            `[${requestId}] Authorization error during preprocessing, disabling schedule: ${preprocessResult.error?.message}`
          )
          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              lastQueuedAt: null,
              lastFailedAt: now,
              status: 'disabled',
            },
            requestId,
            `Failed to disable schedule ${payload.scheduleId} after authorization error`,
            `Disabled schedule ${payload.scheduleId} due to authorization failure (403)`
          )
          return
        }

        case 404: {
          logger.warn(`[${requestId}] Workflow not found, disabling schedule`)
          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              lastQueuedAt: null,
              status: 'disabled',
            },
            requestId,
            `Failed to disable schedule ${payload.scheduleId} after missing workflow`,
            `Disabled schedule ${payload.scheduleId} because the workflow no longer exists`
          )
          return
        }

        case 429: {
          logger.warn(`[${requestId}] Rate limit exceeded, scheduling retry`)
          const retryDelay = 5 * 60 * 1000
          const nextRetryAt = new Date(now.getTime() + retryDelay)

          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              nextRunAt: nextRetryAt,
            },
            requestId,
            `Error updating schedule ${payload.scheduleId} for rate limit`,
            `Updated next retry time for schedule ${payload.scheduleId} due to rate limit`
          )
          return
        }

        case 402: {
          logger.warn(`[${requestId}] Usage limit exceeded, scheduling next run`)
          const nextRunAt = await calculateNextRunFromDeployment(payload, requestId)
          if (nextRunAt) {
            await applyScheduleUpdate(
              payload.scheduleId,
              {
                updatedAt: now,
                nextRunAt,
              },
              requestId,
              `Error updating schedule ${payload.scheduleId} after usage limit check`,
              `Scheduled next run for ${payload.scheduleId} after usage limit`
            )
          }
          return
        }

        default: {
          logger.error(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`)
          const nextRunAt = await determineNextRunAfterError(payload, now, requestId)
          const newFailedCount = (payload.failedCount || 0) + 1
          const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

          if (shouldDisable) {
            logger.warn(
              `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
            )
          }

          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              nextRunAt,
              failedCount: newFailedCount,
              lastFailedAt: now,
              status: shouldDisable ? 'disabled' : 'active',
            },
            requestId,
            `Error updating schedule ${payload.scheduleId} after preprocessing failure`,
            `Updated schedule ${payload.scheduleId} after preprocessing failure`
          )
          return
        }
      }
    }

    const { actorUserId, workflowRecord } = preprocessResult
    if (!actorUserId || !workflowRecord) {
      logger.error(`[${requestId}] Missing required preprocessing data`)
      return
    }

    logger.info(`[${requestId}] Executing scheduled workflow ${payload.workflowId}`)

    try {
      const executionResult = await runWorkflowExecution({
        payload,
        workflowRecord,
        actorUserId,
        loggingSession,
        requestId,
        executionId,
        asyncTimeout: preprocessResult.executionTimeout?.async,
      })

      if (executionResult.status === 'skip') {
        await releaseScheduleLock(
          payload.scheduleId,
          requestId,
          now,
          `Failed to release schedule ${payload.scheduleId} after skip`,
          scheduledFor ?? now
        )
        return
      }

      if (executionResult.status === 'success') {
        logger.info(`[${requestId}] Workflow ${payload.workflowId} executed successfully`)

        const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)

        await applyScheduleUpdate(
          payload.scheduleId,
          {
            lastRanAt: now,
            updatedAt: now,
            nextRunAt,
            failedCount: 0,
            lastQueuedAt: null,
          },
          requestId,
          `Error updating schedule ${payload.scheduleId} after success`,
          `Updated next run time for workflow ${payload.workflowId} to ${nextRunAt.toISOString()}`
        )
        return
      }

      logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)

      const newFailedCount = (payload.failedCount || 0) + 1
      const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
      if (shouldDisable) {
        logger.warn(
          `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
        )
      }

      const nextRunAt = calculateNextRunTime(payload, executionResult.blocks)

      await applyScheduleUpdate(
        payload.scheduleId,
        {
          updatedAt: now,
          nextRunAt,
          failedCount: newFailedCount,
          lastFailedAt: now,
          status: shouldDisable ? 'disabled' : 'active',
        },
        requestId,
        `Error updating schedule ${payload.scheduleId} after failure`,
        `Updated schedule ${payload.scheduleId} after failure`
      )
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('Service overloaded')) {
        logger.warn(`[${requestId}] Service overloaded, retrying schedule in 5 minutes`)

        const retryDelay = 5 * 60 * 1000
        const nextRetryAt = new Date(now.getTime() + retryDelay)

        await applyScheduleUpdate(
          payload.scheduleId,
          {
            updatedAt: now,
            nextRunAt: nextRetryAt,
          },
          requestId,
          `Error updating schedule ${payload.scheduleId} for service overload`,
          `Updated schedule ${payload.scheduleId} retry time due to service overload`
        )
        return
      }

      logger.error(`[${requestId}] Error executing scheduled workflow ${payload.workflowId}`, error)

      const nextRunAt = await determineNextRunAfterError(payload, now, requestId)
      const newFailedCount = (payload.failedCount || 0) + 1
      const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

      if (shouldDisable) {
        logger.warn(
          `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
        )
      }

      await applyScheduleUpdate(
        payload.scheduleId,
        {
          updatedAt: now,
          nextRunAt,
          failedCount: newFailedCount,
          lastFailedAt: now,
          status: shouldDisable ? 'disabled' : 'active',
        },
        requestId,
        `Error updating schedule ${payload.scheduleId} after execution error`,
        `Updated schedule ${payload.scheduleId} after execution error`
      )
    }
  } catch (error: unknown) {
    logger.error(`[${requestId}] Error processing schedule ${payload.scheduleId}`, error)
  }
}

export const scheduleExecution = task({
  id: 'schedule-execution',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: ScheduleExecutionPayload) => executeScheduleJob(payload),
})
