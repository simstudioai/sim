import { db, workflow, workflowSchedule } from '@sim/db'
import { task } from '@trigger.dev/sdk'
import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
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
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { Serializer } from '@/serializer'
import { RateLimiter } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerScheduleExecution')

const MAX_CONSECUTIVE_FAILURES = 3

export type ScheduleExecutionPayload = {
  scheduleId: string
  workflowId: string
  blockId?: string
  cronExpression?: string
  lastRanAt?: string
  failedCount?: number
  now: string
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

  // Get timezone from schedule configuration (default to UTC)
  const timezone = scheduleValues.timezone || 'UTC'

  if (schedule.cronExpression) {
    // Use Croner with timezone support for accurate scheduling
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

  logger.info(`[${requestId}] Starting schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  const EnvVarsSchema = (await import('zod')).z.record((await import('zod')).z.string())

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow ${payload.workflowId} not found`)
      return
    }

    let actorUserId: string | null = null

    if (workflowRecord.workspaceId) {
      actorUserId = await getWorkspaceBilledAccountUserId(workflowRecord.workspaceId)
    }

    if (!actorUserId) {
      actorUserId = workflowRecord.userId ?? null
    }

    if (!actorUserId) {
      logger.warn(
        `[${requestId}] Skipping schedule ${payload.scheduleId}: unable to resolve billed account.`
      )
      return
    }

    const userSubscription = await getHighestPrioritySubscription(actorUserId)

    const rateLimiter = new RateLimiter()
    const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
      actorUserId,
      userSubscription,
      'schedule',
      false
    )

    if (!rateLimitCheck.allowed) {
      logger.warn(
        `[${requestId}] Rate limit exceeded for scheduled workflow ${payload.workflowId}`,
        {
          userId: workflowRecord.userId,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt,
        }
      )

      const retryDelay = 5 * 60 * 1000
      const nextRetryAt = new Date(now.getTime() + retryDelay)

      try {
        await db
          .update(workflowSchedule)
          .set({
            updatedAt: now,
            nextRunAt: nextRetryAt,
          })
          .where(eq(workflowSchedule.id, payload.scheduleId))

        logger.debug(`[${requestId}] Updated next retry time due to rate limit`)
      } catch (updateError) {
        logger.error(`[${requestId}] Error updating schedule for rate limit:`, updateError)
      }

      return
    }

    const usageCheck = await checkServerSideUsageLimits(actorUserId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${workflowRecord.userId} has exceeded usage limits. Skipping scheduled execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: payload.workflowId,
        }
      )
      try {
        const deployedData = await loadDeployedWorkflowState(payload.workflowId)
        const nextRunAt = calculateNextRunTime(payload, deployedData.blocks as any)
        await db
          .update(workflowSchedule)
          .set({ updatedAt: now, nextRunAt })
          .where(eq(workflowSchedule.id, payload.scheduleId))
      } catch (calcErr) {
        logger.warn(
          `[${requestId}] Unable to calculate nextRunAt while skipping schedule ${payload.scheduleId}`,
          calcErr
        )
      }
      return
    }

    logger.info(`[${requestId}] Executing scheduled workflow ${payload.workflowId}`)

    const loggingSession = new LoggingSession(
      payload.workflowId,
      executionId,
      'schedule',
      requestId
    )

    try {
      const executionSuccess = await (async () => {
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
              return { skip: true, blocks: {} as Record<string, BlockState> }
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

          const currentBlockStates = await Object.entries(mergedStates).reduce(
            async (accPromise, [id, block]) => {
              const acc = await accPromise
              acc[id] = await Object.entries(block.subBlocks).reduce(
                async (subAccPromise, [key, subBlock]) => {
                  const subAcc = await subAccPromise
                  let value = subBlock.value

                  if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
                    const matches = value.match(/{{([^}]+)}}/g)
                    if (matches) {
                      for (const match of matches) {
                        const varName = match.slice(2, -2)
                        const encryptedValue = variables[varName]
                        if (!encryptedValue) {
                          throw new Error(`Environment variable "${varName}" was not found`)
                        }

                        try {
                          const { decrypted } = await decryptSecret(encryptedValue)
                          value = (value as string).replace(match, decrypted)
                        } catch (error: any) {
                          logger.error(
                            `[${requestId}] Error decrypting value for variable "${varName}"`,
                            error
                          )
                          throw new Error(
                            `Failed to decrypt environment variable "${varName}": ${error.message}`
                          )
                        }
                      }
                    }
                  }

                  subAcc[key] = value
                  return subAcc
                },
                Promise.resolve({} as Record<string, any>)
              )
              return acc
            },
            Promise.resolve({} as Record<string, Record<string, any>>)
          )

          const decryptedEnvVars: Record<string, string> = {}
          for (const [key, encryptedValue] of Object.entries(variables)) {
            try {
              const { decrypted } = await decryptSecret(encryptedValue)
              decryptedEnvVars[key] = decrypted
            } catch (error: any) {
              logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
              throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
            }
          }

          const processedBlockStates = Object.entries(currentBlockStates).reduce(
            (acc, [blockId, blockState]) => {
              if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
                const responseFormatValue = blockState.responseFormat.trim()

                if (responseFormatValue.startsWith('<') && responseFormatValue.includes('>')) {
                  logger.debug(
                    `[${requestId}] Response format contains variable reference for block ${blockId}`
                  )
                  acc[blockId] = blockState
                } else if (responseFormatValue === '') {
                  acc[blockId] = {
                    ...blockState,
                    responseFormat: undefined,
                  }
                } else {
                  try {
                    logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
                    const parsedResponseFormat = JSON.parse(responseFormatValue)

                    acc[blockId] = {
                      ...blockState,
                      responseFormat: parsedResponseFormat,
                    }
                  } catch (error) {
                    logger.warn(
                      `[${requestId}] Failed to parse responseFormat for block ${blockId}, using undefined`,
                      error
                    )
                    acc[blockId] = {
                      ...blockState,
                      responseFormat: undefined,
                    }
                  }
                }
              } else {
                acc[blockId] = blockState
              }
              return acc
            },
            {} as Record<string, Record<string, any>>
          )

          const workflowVariables = (workflowRecord.variables as Record<string, any>) || {}

          const serializedWorkflow = new Serializer().serializeWorkflow(
            mergedStates,
            edges,
            loops,
            parallels,
            true
          )

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

          // Use core execution function
          const executionResult = await executeWorkflowCore({
            requestId,
            workflowId: payload.workflowId,
            userId: actorUserId,
            workflow: { ...workflowRecord, workspaceId: workflowRecord.workspaceId },
            input,
            triggerType: 'schedule',
            loggingSession,
            executionId,
            workspaceId: workflowRecord.workspaceId || '',
            triggerBlockId: payload.blockId || undefined,
          })

          logger.info(`[${requestId}] Workflow execution completed: ${payload.workflowId}`, {
            success: executionResult.success,
            executionTime: executionResult.metadata?.duration,
          })

          return { success: executionResult.success, blocks, executionResult }
        } catch (earlyError: any) {
          logger.error(
            `[${requestId}] Early failure in scheduled workflow ${payload.workflowId}`,
            earlyError
          )

          try {
            await loggingSession.safeStart({
              userId: workflowRecord.userId,
              workspaceId: workflowRecord.workspaceId || '',
              variables: {},
            })

            await loggingSession.safeCompleteWithError({
              error: {
                message: `Schedule execution failed before workflow started: ${earlyError.message}`,
                stackTrace: earlyError.stack,
              },
              traceSpans: [],
            })
          } catch (loggingError) {
            logger.error(
              `[${requestId}] Failed to create log entry for early schedule failure`,
              loggingError
            )
          }

          throw earlyError
        }
      })()

      if ('skip' in executionSuccess && executionSuccess.skip) {
        return
      }

      if (executionSuccess.success) {
        logger.info(`[${requestId}] Workflow ${payload.workflowId} executed successfully`)

        const nextRunAt = calculateNextRunTime(payload, executionSuccess.blocks)

        logger.debug(
          `[${requestId}] Calculated next run time: ${nextRunAt.toISOString()} for workflow ${payload.workflowId}`
        )

        try {
          await db
            .update(workflowSchedule)
            .set({
              lastRanAt: now,
              updatedAt: now,
              nextRunAt,
              failedCount: 0,
            })
            .where(eq(workflowSchedule.id, payload.scheduleId))

          logger.debug(
            `[${requestId}] Updated next run time for workflow ${payload.workflowId} to ${nextRunAt.toISOString()}`
          )
        } catch (updateError) {
          logger.error(`[${requestId}] Error updating schedule after success:`, updateError)
        }
      } else {
        logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)

        const newFailedCount = (payload.failedCount || 0) + 1
        const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
        const nextRunAt = calculateNextRunTime(payload, executionSuccess.blocks)

        if (shouldDisable) {
          logger.warn(
            `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
          )
        }

        try {
          await db
            .update(workflowSchedule)
            .set({
              updatedAt: now,
              nextRunAt,
              failedCount: newFailedCount,
              lastFailedAt: now,
              status: shouldDisable ? 'disabled' : 'active',
            })
            .where(eq(workflowSchedule.id, payload.scheduleId))

          logger.debug(`[${requestId}] Updated schedule after failure`)
        } catch (updateError) {
          logger.error(`[${requestId}] Error updating schedule after failure:`, updateError)
        }
      }
    } catch (error: any) {
      if (error.message?.includes('Service overloaded')) {
        logger.warn(`[${requestId}] Service overloaded, retrying schedule in 5 minutes`)

        const retryDelay = 5 * 60 * 1000
        const nextRetryAt = new Date(now.getTime() + retryDelay)

        try {
          await db
            .update(workflowSchedule)
            .set({
              updatedAt: now,
              nextRunAt: nextRetryAt,
            })
            .where(eq(workflowSchedule.id, payload.scheduleId))

          logger.debug(`[${requestId}] Updated schedule retry time due to service overload`)
        } catch (updateError) {
          logger.error(`[${requestId}] Error updating schedule for service overload:`, updateError)
        }
      } else {
        logger.error(
          `[${requestId}] Error executing scheduled workflow ${payload.workflowId}`,
          error
        )

        try {
          const failureLoggingSession = new LoggingSession(
            payload.workflowId,
            executionId,
            'schedule',
            requestId
          )

          await failureLoggingSession.safeStart({
            userId: workflowRecord.userId,
            workspaceId: workflowRecord.workspaceId || '',
            variables: {},
          })

          await failureLoggingSession.safeCompleteWithError({
            error: {
              message: `Schedule execution failed: ${error.message}`,
              stackTrace: error.stack,
            },
            traceSpans: [],
          })
        } catch (loggingError) {
          logger.error(
            `[${requestId}] Failed to create log entry for failed schedule execution`,
            loggingError
          )
        }

        let nextRunAt: Date
        try {
          const [workflowRecord] = await db
            .select()
            .from(workflow)
            .where(eq(workflow.id, payload.workflowId))
            .limit(1)

          if (workflowRecord?.isDeployed) {
            try {
              const deployedData = await loadDeployedWorkflowState(payload.workflowId)
              nextRunAt = calculateNextRunTime(payload, deployedData.blocks as any)
            } catch {
              nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
            }
          } else {
            nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
          }
        } catch (workflowError) {
          logger.error(
            `[${requestId}] Error retrieving workflow for next run calculation`,
            workflowError
          )
          nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        }

        const newFailedCount = (payload.failedCount || 0) + 1
        const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

        if (shouldDisable) {
          logger.warn(
            `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
          )
        }

        try {
          await db
            .update(workflowSchedule)
            .set({
              updatedAt: now,
              nextRunAt,
              failedCount: newFailedCount,
              lastFailedAt: now,
              status: shouldDisable ? 'disabled' : 'active',
            })
            .where(eq(workflowSchedule.id, payload.scheduleId))

          logger.debug(`[${requestId}] Updated schedule after execution error`)
        } catch (updateError) {
          logger.error(`[${requestId}] Error updating schedule after execution error:`, updateError)
        }
      }
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
