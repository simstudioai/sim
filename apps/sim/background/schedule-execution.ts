import { db, jobExecutionLogs, workflow, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { Cron } from 'croner'
import { and, eq, isNull } from 'drizzle-orm'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { generateId } from '@/lib/core/utils/uuid'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
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
  validateCronExpression,
} from '@/lib/workflows/schedules/utils'
import { getWorkspaceById } from '@/lib/workspaces/permissions/utils'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { buildAPIUrl, buildAuthHeaders } from '@/executor/utils/http'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

const logger = createLogger('TriggerScheduleExecution')

type WorkflowRecord = typeof workflow.$inferSelect
type WorkflowScheduleUpdate = Partial<typeof workflowSchedule.$inferInsert>
type ExecutionCoreResult = Awaited<ReturnType<typeof executeWorkflowCore>>

type RunWorkflowResult =
  | { status: 'skip'; blocks: Record<string, BlockState> }
  | { status: 'success'; blocks: Record<string, BlockState>; executionResult: ExecutionCoreResult }
  | { status: 'failure'; blocks: Record<string, BlockState>; executionResult: ExecutionCoreResult }

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
  context: string
) {
  try {
    await db
      .update(workflowSchedule)
      .set(updates)
      .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))
  } catch (error) {
    logger.error(`[${requestId}] ${context}`, error)
  }
}

export async function releaseScheduleLock(
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
  try {
    const deployedData = await loadDeployedWorkflowState(
      payload.workflowId,
      workflowRecord.workspaceId ?? undefined
    )

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
    logger.error(`[${requestId}] Early failure in scheduled workflow ${payload.workflowId}`, error)

    if (wasExecutionFinalizedByCore(error, executionId)) {
      throw error
    }

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
  workspaceId?: string
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
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
  const correlation = buildScheduleCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId
  const now = new Date(payload.now)
  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  try {
    const [scheduleRecord] = await db
      .select({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        status: workflowSchedule.status,
        archivedAt: workflowSchedule.archivedAt,
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

    if (scheduleRecord.archivedAt || scheduleRecord.status === 'disabled') {
      logger.info(`[${requestId}] Schedule is archived or disabled, skipping execution`, {
        scheduleId: payload.scheduleId,
      })
      await releaseScheduleLock(
        payload.scheduleId,
        requestId,
        now,
        `Failed to release schedule ${payload.scheduleId} after archive/disabled check`
      )
      return
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
          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              lastQueuedAt: null,
              lastFailedAt: now,
              status: 'disabled',
            },
            requestId,
            `Failed to disable schedule ${payload.scheduleId} after authentication error`
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
            `Failed to disable schedule ${payload.scheduleId} after authorization error`
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
            `Failed to disable schedule ${payload.scheduleId} after missing workflow`
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
              lastQueuedAt: null,
            },
            requestId,
            `Error updating schedule ${payload.scheduleId} for rate limit`
          )
          return
        }

        case 402: {
          logger.warn(`[${requestId}] Usage limit exceeded, scheduling next run`)
          const nextRunAt =
            (await calculateNextRunFromDeployment(payload, requestId)) ??
            new Date(now.getTime() + 60 * 60 * 1000)
          await applyScheduleUpdate(
            payload.scheduleId,
            {
              updatedAt: now,
              lastQueuedAt: null,
              nextRunAt,
            },
            requestId,
            `Error updating schedule ${payload.scheduleId} after usage limit check`
          )
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
              lastQueuedAt: null,
              nextRunAt,
              failedCount: newFailedCount,
              lastFailedAt: now,
              status: shouldDisable ? 'disabled' : 'active',
            },
            requestId,
            `Error updating schedule ${payload.scheduleId} after preprocessing failure`
          )
          return
        }
      }
    }

    const { actorUserId, workflowRecord } = preprocessResult
    if (!actorUserId || !workflowRecord) {
      logger.error(`[${requestId}] Missing required preprocessing data`)
      await releaseScheduleLock(
        payload.scheduleId,
        requestId,
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

      if (executionResult.status === 'skip') {
        await applyScheduleUpdate(
          payload.scheduleId,
          {
            updatedAt: now,
            lastQueuedAt: null,
            lastFailedAt: now,
            status: 'disabled',
            nextRunAt: null,
          },
          requestId,
          `Failed to disable schedule ${payload.scheduleId} after skip`
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
          `Error updating schedule ${payload.scheduleId} after success`
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
          lastQueuedAt: null,
          nextRunAt,
          failedCount: newFailedCount,
          lastFailedAt: now,
          status: shouldDisable ? 'disabled' : 'active',
        },
        requestId,
        `Error updating schedule ${payload.scheduleId} after failure`
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
            lastQueuedAt: null,
            nextRunAt: nextRetryAt,
          },
          requestId,
          `Error updating schedule ${payload.scheduleId} for service overload`
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
          lastQueuedAt: null,
          nextRunAt,
          failedCount: newFailedCount,
          lastFailedAt: now,
          status: shouldDisable ? 'disabled' : 'active',
        },
        requestId,
        `Error updating schedule ${payload.scheduleId} after execution error`
      )
    }
  } catch (error: unknown) {
    logger.error(`[${requestId}] Error processing schedule ${payload.scheduleId}`, error)
    await releaseScheduleLock(
      payload.scheduleId,
      requestId,
      now,
      `Failed to release schedule ${payload.scheduleId} after unhandled error`
    )
  }
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
      error: error instanceof Error ? error.message : String(error),
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
      `Failed to release job ${payload.scheduleId} after missing fields`
    )
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
      `Failed to release job ${payload.scheduleId} after archive/disabled check`
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
      `Failed to release job ${payload.scheduleId} after completed skip`
    )
    return
  }

  const promptText = buildJobPrompt(jobRecord)

  try {
    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders(jobRecord.sourceUserId)

    const body = {
      messages: [{ role: 'user', content: promptText }],
      workspaceId: jobRecord.sourceWorkspaceId,
      userId: jobRecord.sourceUserId,
      chatId: jobRecord.sourceChatId || generateId(),
    }

    const startTime = new Date()
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const endTime = new Date()
    const durationMs = endTime.getTime() - startTime.getTime()

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')

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
      // Response may not be JSON; proceed with normal flow
    }

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
        `Error updating job ${payload.scheduleId} after completion`
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
      `Error updating job ${payload.scheduleId} after success`
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
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
      `Error updating job ${payload.scheduleId} after failure`
    )
  }
}

export const scheduleExecution = task({
  id: 'schedule-execution',
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: ScheduleExecutionPayload) => executeScheduleJob(payload),
})
