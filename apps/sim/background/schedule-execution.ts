import { db, workflow, workflowSchedule } from '@sim/db'
import { task } from '@trigger.dev/sdk'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ZodRecord, ZodString } from 'zod'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
} from '@/lib/schedules/utils'
import { decryptSecret } from '@/lib/utils'
import { blockExistsInDeployment, loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { type ExecutionMetadata, ExecutionSnapshot } from '@/executor/execution/snapshot'
import { RateLimiter } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerScheduleExecution')

const MAX_CONSECUTIVE_FAILURES = 3

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

async function resolveActorUserId(workflowRecord: WorkflowRecord) {
  if (workflowRecord.workspaceId) {
    const actor = await getWorkspaceBilledAccountUserId(workflowRecord.workspaceId)
    if (actor) {
      return actor
    }
  }

  return workflowRecord.userId ?? null
}

async function handleWorkflowNotFound(
  payload: ScheduleExecutionPayload,
  executionId: string,
  requestId: string,
  now: Date
) {
  const loggingSession = new LoggingSession(payload.workflowId, executionId, 'schedule', requestId)

  await loggingSession.safeStart({
    userId: 'unknown',
    workspaceId: '',
    variables: {},
  })

  await loggingSession.safeCompleteWithError({
    error: {
      message:
        'Workflow not found. The scheduled workflow may have been deleted or is no longer accessible.',
      stackTrace: undefined,
    },
    traceSpans: [],
  })

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
}

async function handleMissingActor(
  payload: ScheduleExecutionPayload,
  workflowRecord: WorkflowRecord,
  executionId: string,
  requestId: string,
  now: Date
) {
  const loggingSession = new LoggingSession(payload.workflowId, executionId, 'schedule', requestId)

  await loggingSession.safeStart({
    userId: workflowRecord.userId ?? 'unknown',
    workspaceId: workflowRecord.workspaceId || '',
    variables: {},
  })

  await loggingSession.safeCompleteWithError({
    error: {
      message:
        'Unable to resolve billing account. This workflow cannot execute scheduled runs without a valid billing account.',
      stackTrace: undefined,
    },
    traceSpans: [],
  })

  await releaseScheduleLock(
    payload.scheduleId,
    requestId,
    now,
    `Failed to release schedule ${payload.scheduleId} after billing account lookup`
  )
}

async function ensureRateLimit(
  actorUserId: string,
  userSubscription: Awaited<ReturnType<typeof getHighestPrioritySubscription>>,
  rateLimiter: RateLimiter,
  loggingSession: LoggingSession,
  payload: ScheduleExecutionPayload,
  workflowRecord: WorkflowRecord,
  requestId: string,
  now: Date
) {
  const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
    actorUserId,
    userSubscription,
    'schedule',
    false
  )

  if (rateLimitCheck.allowed) {
    return true
  }

  logger.warn(`[${requestId}] Rate limit exceeded for scheduled workflow ${payload.workflowId}`, {
    userId: workflowRecord.userId,
    remaining: rateLimitCheck.remaining,
    resetAt: rateLimitCheck.resetAt,
  })

  await loggingSession.safeStart({
    userId: actorUserId,
    workspaceId: workflowRecord.workspaceId || '',
    variables: {},
  })

  await loggingSession.safeCompleteWithError({
    error: {
      message: `Rate limit exceeded. ${rateLimitCheck.remaining || 0} requests remaining. Resets at ${
        rateLimitCheck.resetAt ? new Date(rateLimitCheck.resetAt).toISOString() : 'unknown'
      }. Schedule will retry in 5 minutes.`,
      stackTrace: undefined,
    },
    traceSpans: [],
  })

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

  return false
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

async function ensureUsageLimits(
  actorUserId: string,
  payload: ScheduleExecutionPayload,
  workflowRecord: WorkflowRecord,
  loggingSession: LoggingSession,
  requestId: string,
  now: Date
) {
  const usageCheck = await checkServerSideUsageLimits(actorUserId)
  if (!usageCheck.isExceeded) {
    return true
  }

  logger.warn(
    `[${requestId}] User ${workflowRecord.userId} has exceeded usage limits. Skipping scheduled execution.`,
    {
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
      workflowId: payload.workflowId,
    }
  )

  await loggingSession.safeStart({
    userId: actorUserId,
    workspaceId: workflowRecord.workspaceId || '',
    variables: {},
  })

  await loggingSession.safeCompleteWithError({
    error: {
      message:
        usageCheck.message ||
        'Usage limit exceeded. Please upgrade your plan to continue using scheduled workflows.',
      stackTrace: undefined,
    },
    traceSpans: [],
  })

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

  return false
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

async function ensureBlockVariablesResolvable(
  blocks: Record<string, BlockState>,
  variables: Record<string, string>,
  requestId: string
) {
  await Promise.all(
    Object.values(blocks).map(async (block) => {
      const subBlocks = block.subBlocks ?? {}
      await Promise.all(
        Object.values(subBlocks).map(async (subBlock) => {
          const value = subBlock.value
          if (typeof value !== 'string' || !value.includes('{{') || !value.includes('}}')) {
            return
          }

          const matches = value.match(/{{([^}]+)}}/g)
          if (!matches) {
            return
          }

          for (const match of matches) {
            const varName = match.slice(2, -2)
            const encryptedValue = variables[varName]
            if (!encryptedValue) {
              throw new Error(`Environment variable "${varName}" was not found`)
            }

            try {
              await decryptSecret(encryptedValue)
            } catch (error) {
              logger.error(`[${requestId}] Error decrypting value for variable "${varName}"`, error)

              const message = error instanceof Error ? error.message : 'Unknown error'
              throw new Error(`Failed to decrypt environment variable "${varName}": ${message}`)
            }
          }
        })
      )
    })
  )
}

async function ensureEnvVarsDecryptable(variables: Record<string, string>, requestId: string) {
  for (const [key, encryptedValue] of Object.entries(variables)) {
    try {
      await decryptSecret(encryptedValue)
    } catch (error) {
      logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to decrypt environment variable "${key}": ${message}`)
    }
  }
}

async function runWorkflowExecution({
  payload,
  workflowRecord,
  actorUserId,
  loggingSession,
  requestId,
  executionId,
  EnvVarsSchema,
}: {
  payload: ScheduleExecutionPayload
  workflowRecord: WorkflowRecord
  actorUserId: string
  loggingSession: LoggingSession
  requestId: string
  executionId: string
  EnvVarsSchema: ZodRecord<ZodString, ZodString>
}): Promise<RunWorkflowResult> {
  try {
    logger.debug(`[${requestId}] Loading deployed workflow ${payload.workflowId}`)
    const deployedData = await loadDeployedWorkflowState(payload.workflowId)

    const blocks = deployedData.blocks
    const edges = deployedData.edges
    const loops = deployedData.loops
    const parallels = deployedData.parallels
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

    const mergedStates = mergeSubblockState(blocks)

    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      actorUserId,
      workflowRecord.workspaceId || undefined
    )

    const variables = EnvVarsSchema.parse({
      ...personalEncrypted,
      ...workspaceEncrypted,
    })

    await ensureBlockVariablesResolvable(mergedStates, variables, requestId)
    await ensureEnvVarsDecryptable(variables, requestId)

    const input = {
      _context: {
        workflowId: payload.workflowId,
      },
    }

    await loggingSession.safeStart({
      userId: actorUserId,
      workspaceId: workflowRecord.workspaceId || '',
      variables: variables || {},
    })

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId: payload.workflowId,
      workspaceId: workflowRecord.workspaceId || '',
      userId: actorUserId,
      triggerType: 'schedule',
      triggerBlockId: payload.blockId || undefined,
      useDraftState: false,
      startTime: new Date().toISOString(),
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflowRecord,
      input,
      {},
      workflowRecord.variables || {},
      []
    )

    const executionResult = await executeWorkflowCore({
      snapshot,
      callbacks: {},
      loggingSession,
    })

    if (executionResult.status === 'paused') {
      if (!executionResult.snapshotSeed) {
        logger.error(`[${requestId}] Missing snapshot seed for paused execution`, {
          executionId,
        })
      } else {
        await PauseResumeManager.persistPauseResult({
          workflowId: payload.workflowId,
          executionId,
          pausePoints: executionResult.pausePoints || [],
          snapshotSeed: executionResult.snapshotSeed,
          executorUserId: executionResult.metadata?.userId,
        })
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
  } catch (earlyError) {
    logger.error(
      `[${requestId}] Early failure in scheduled workflow ${payload.workflowId}`,
      earlyError
    )

    try {
      await loggingSession.safeCompleteWithError({
        error: {
          message: `Schedule execution failed: ${
            earlyError instanceof Error ? earlyError.message : String(earlyError)
          }`,
          stackTrace: earlyError instanceof Error ? earlyError.stack : undefined,
        },
        traceSpans: [],
      })
    } catch (loggingError) {
      logger.error(`[${requestId}] Failed to complete log entry for schedule failure`, loggingError)
    }

    throw earlyError
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

  const lastRanAt = schedule.lastRanAt ? new Date(schedule.lastRanAt) : null
  return calculateNextTime(scheduleType, scheduleValues, lastRanAt)
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

  const zod = await import('zod')
  const EnvVarsSchema = zod.z.record(zod.z.string())

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} not found`)
      await handleWorkflowNotFound(payload, executionId, requestId, now)
      return
    }

    const actorUserId = await resolveActorUserId(workflowRecord)
    if (!actorUserId) {
      logger.warn(
        `[${requestId}] Skipping schedule ${payload.scheduleId}: unable to resolve billed account.`
      )
      await handleMissingActor(payload, workflowRecord, executionId, requestId, now)
      return
    }

    const userSubscription = await getHighestPrioritySubscription(actorUserId)

    const loggingSession = new LoggingSession(
      payload.workflowId,
      executionId,
      'schedule',
      requestId
    )

    const rateLimiter = new RateLimiter()
    const withinRateLimit = await ensureRateLimit(
      actorUserId,
      userSubscription,
      rateLimiter,
      loggingSession,
      payload,
      workflowRecord,
      requestId,
      now
    )

    if (!withinRateLimit) {
      return
    }

    const withinUsageLimits = await ensureUsageLimits(
      actorUserId,
      payload,
      workflowRecord,
      loggingSession,
      requestId,
      now
    )
    if (!withinUsageLimits) {
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
        EnvVarsSchema,
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
    } catch (error: any) {
      if (error?.message?.includes('Service overloaded')) {
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
  } catch (error: any) {
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
