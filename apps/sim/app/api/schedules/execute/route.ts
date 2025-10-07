import { db, userStats, workflow, workflowSchedule } from '@sim/db'
import { Cron } from 'croner'
import { and, eq, lte, not, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
} from '@/lib/schedules/utils'
import { decryptSecret, generateRequestId } from '@/lib/utils'
import { blockExistsInDeployment, loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { RateLimiter } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ScheduledExecuteAPI')

// Maximum number of consecutive failures before disabling a schedule
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * Calculate the next run time for a schedule
 * This is a wrapper around the utility function in schedule-utils.ts
 */
function calculateNextRunTime(
  schedule: typeof workflowSchedule.$inferSelect,
  blocks: Record<string, BlockState>
): Date {
  // Look for either starter block or schedule trigger block
  const scheduleBlock = Object.values(blocks).find(
    (block) => block.type === 'starter' || block.type === 'schedule'
  )
  if (!scheduleBlock) throw new Error('No starter or schedule block found')
  const scheduleType = getSubBlockValue(scheduleBlock, 'scheduleType')
  const scheduleValues = getScheduleTimeValues(scheduleBlock)

  if (schedule.cronExpression) {
    const cron = new Cron(schedule.cronExpression)
    const nextDate = cron.nextRun()
    if (!nextDate) throw new Error('Invalid cron expression or no future occurrences')
    return nextDate
  }

  const lastRanAt = schedule.lastRanAt ? new Date(schedule.lastRanAt) : null
  return calculateNextTime(scheduleType, scheduleValues, lastRanAt)
}

const EnvVarsSchema = z.record(z.string())

const runningExecutions = new Set<string>()

export async function GET() {
  logger.info(`Scheduled execution triggered at ${new Date().toISOString()}`)
  const requestId = generateRequestId()
  const now = new Date()

  let dueSchedules: (typeof workflowSchedule.$inferSelect)[] = []

  try {
    dueSchedules = await db
      .select()
      .from(workflowSchedule)
      .where(
        and(lte(workflowSchedule.nextRunAt, now), not(eq(workflowSchedule.status, 'disabled')))
      )
      .limit(10)

    logger.debug(`[${requestId}] Successfully queried schedules: ${dueSchedules.length} found`)

    logger.info(`[${requestId}] Processing ${dueSchedules.length} due scheduled workflows`)

    for (const schedule of dueSchedules) {
      const executionId = uuidv4()

      try {
        if (runningExecutions.has(schedule.workflowId)) {
          logger.debug(`[${requestId}] Skipping workflow ${schedule.workflowId} - already running`)
          continue
        }

        runningExecutions.add(schedule.workflowId)
        logger.debug(`[${requestId}] Starting execution of workflow ${schedule.workflowId}`)

        const [workflowRecord] = await db
          .select()
          .from(workflow)
          .where(eq(workflow.id, schedule.workflowId))
          .limit(1)

        if (!workflowRecord) {
          logger.warn(`[${requestId}] Workflow ${schedule.workflowId} not found`)
          runningExecutions.delete(schedule.workflowId)
          continue
        }

        const actorUserId = await getApiKeyOwnerUserId(workflowRecord.pinnedApiKeyId)

        if (!actorUserId) {
          logger.warn(
            `[${requestId}] Skipping schedule ${schedule.id}: pinned API key required to attribute usage.`
          )
          runningExecutions.delete(schedule.workflowId)
          continue
        }

        // Check rate limits for scheduled execution (checks both personal and org subscriptions)
        const userSubscription = await getHighestPrioritySubscription(actorUserId)

        const rateLimiter = new RateLimiter()
        const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
          actorUserId,
          userSubscription,
          'schedule',
          false // schedules are always sync
        )

        if (!rateLimitCheck.allowed) {
          logger.warn(
            `[${requestId}] Rate limit exceeded for scheduled workflow ${schedule.workflowId}`,
            {
              userId: workflowRecord.userId,
              remaining: rateLimitCheck.remaining,
              resetAt: rateLimitCheck.resetAt,
            }
          )

          // Retry in 5 minutes for rate limit
          const retryDelay = 5 * 60 * 1000 // 5 minutes
          const nextRetryAt = new Date(now.getTime() + retryDelay)

          try {
            await db
              .update(workflowSchedule)
              .set({
                updatedAt: now,
                nextRunAt: nextRetryAt,
              })
              .where(eq(workflowSchedule.id, schedule.id))

            logger.debug(`[${requestId}] Updated next retry time due to rate limit`)
          } catch (updateError) {
            logger.error(`[${requestId}] Error updating schedule for rate limit:`, updateError)
          }

          runningExecutions.delete(schedule.workflowId)
          continue
        }

        const usageCheck = await checkServerSideUsageLimits(actorUserId)
        if (usageCheck.isExceeded) {
          logger.warn(
            `[${requestId}] User ${workflowRecord.userId} has exceeded usage limits. Skipping scheduled execution.`,
            {
              currentUsage: usageCheck.currentUsage,
              limit: usageCheck.limit,
              workflowId: schedule.workflowId,
            }
          )
          try {
            const deployedData = await loadDeployedWorkflowState(schedule.workflowId)
            const nextRunAt = calculateNextRunTime(schedule, deployedData.blocks as any)
            await db
              .update(workflowSchedule)
              .set({ updatedAt: now, nextRunAt })
              .where(eq(workflowSchedule.id, schedule.id))
          } catch (calcErr) {
            logger.warn(
              `[${requestId}] Unable to calculate nextRunAt while skipping schedule ${schedule.id}`,
              calcErr
            )
          }
          runningExecutions.delete(schedule.workflowId)
          continue
        }

        // Execute scheduled workflow immediately (no queuing)
        logger.info(`[${requestId}] Executing scheduled workflow ${schedule.workflowId}`)

        try {
          const executionSuccess = await (async () => {
            // Create logging session inside the execution callback
            const loggingSession = new LoggingSession(
              schedule.workflowId,
              executionId,
              'schedule',
              requestId
            )

            try {
              logger.debug(`[${requestId}] Loading deployed workflow ${schedule.workflowId}`)
              const deployedData = await loadDeployedWorkflowState(schedule.workflowId)

              const blocks = deployedData.blocks
              const edges = deployedData.edges
              const loops = deployedData.loops
              const parallels = deployedData.parallels
              logger.info(`[${requestId}] Loaded deployed workflow ${schedule.workflowId}`)

              // Validate that the schedule's trigger block exists in the deployed state
              if (schedule.blockId) {
                const blockExists = await blockExistsInDeployment(
                  schedule.workflowId,
                  schedule.blockId
                )
                if (!blockExists) {
                  logger.warn(
                    `[${requestId}] Schedule trigger block ${schedule.blockId} not found in deployed workflow ${schedule.workflowId}. Skipping execution.`
                  )
                  return { skip: true, blocks: {} as Record<string, BlockState> }
                }
              }

              const mergedStates = mergeSubblockState(blocks)

              // Retrieve environment variables with workspace precedence
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

                      if (
                        typeof value === 'string' &&
                        value.includes('{{') &&
                        value.includes('}}')
                      ) {
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
                  logger.error(
                    `[${requestId}] Failed to decrypt environment variable "${key}"`,
                    error
                  )
                  throw new Error(
                    `Failed to decrypt environment variable "${key}": ${error.message}`
                  )
                }
              }

              // Process the block states to ensure response formats are properly parsed
              const processedBlockStates = Object.entries(currentBlockStates).reduce(
                (acc, [blockId, blockState]) => {
                  // Check if this block has a responseFormat that needs to be parsed
                  if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
                    const responseFormatValue = blockState.responseFormat.trim()

                    // Check for variable references like <start.input>
                    if (responseFormatValue.startsWith('<') && responseFormatValue.includes('>')) {
                      logger.debug(
                        `[${requestId}] Response format contains variable reference for block ${blockId}`
                      )
                      // Keep variable references as-is - they will be resolved during execution
                      acc[blockId] = blockState
                    } else if (responseFormatValue === '') {
                      // Empty string - remove response format
                      acc[blockId] = {
                        ...blockState,
                        responseFormat: undefined,
                      }
                    } else {
                      try {
                        logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
                        // Attempt to parse the responseFormat if it's a string
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
                        // Set to undefined instead of keeping malformed JSON - this allows execution to continue
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

              // Get workflow variables
              let workflowVariables = {}
              if (workflowRecord.variables) {
                try {
                  if (typeof workflowRecord.variables === 'string') {
                    workflowVariables = JSON.parse(workflowRecord.variables)
                  } else {
                    workflowVariables = workflowRecord.variables
                  }
                } catch (error) {
                  logger.error(`Failed to parse workflow variables: ${schedule.workflowId}`, error)
                }
              }

              const serializedWorkflow = new Serializer().serializeWorkflow(
                mergedStates,
                edges,
                loops,
                parallels,
                true // Enable validation during execution
              )

              const input = {
                _context: {
                  workflowId: schedule.workflowId,
                },
              }

              // Start logging with environment variables
              await loggingSession.safeStart({
                userId: actorUserId,
                workspaceId: workflowRecord.workspaceId || '',
                variables: variables || {},
              })

              const executor = new Executor({
                workflow: serializedWorkflow,
                currentBlockStates: processedBlockStates,
                envVarValues: decryptedEnvVars,
                workflowInput: input,
                workflowVariables,
                contextExtensions: {
                  executionId,
                  workspaceId: workflowRecord.workspaceId || '',
                  isDeployedContext: true,
                },
              })

              // Set up logging on the executor
              loggingSession.setupExecutor(executor)

              const result = await executor.execute(
                schedule.workflowId,
                schedule.blockId || undefined
              )

              const executionResult =
                'stream' in result && 'execution' in result ? result.execution : result

              logger.info(`[${requestId}] Workflow execution completed: ${schedule.workflowId}`, {
                success: executionResult.success,
                executionTime: executionResult.metadata?.duration,
              })

              if (executionResult.success) {
                await updateWorkflowRunCounts(schedule.workflowId)

                try {
                  await db
                    .update(userStats)
                    .set({
                      totalScheduledExecutions: sql`total_scheduled_executions + 1`,
                      lastActive: now,
                    })
                    .where(eq(userStats.userId, actorUserId))

                  logger.debug(`[${requestId}] Updated user stats for scheduled execution`)
                } catch (statsError) {
                  logger.error(`[${requestId}] Error updating user stats:`, statsError)
                }
              }

              const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

              // Complete logging
              await loggingSession.safeComplete({
                endedAt: new Date().toISOString(),
                totalDurationMs: totalDuration || 0,
                finalOutput: executionResult.output || {},
                traceSpans: (traceSpans || []) as any,
              })

              return { success: executionResult.success, blocks, executionResult }
            } catch (earlyError: any) {
              // Handle errors that occur before workflow execution (e.g., missing data, env vars, etc.)
              logger.error(
                `[${requestId}] Early failure in scheduled workflow ${schedule.workflowId}`,
                earlyError
              )

              // Create a minimal log entry for early failures
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

              // Re-throw the error to be handled by the outer catch block
              throw earlyError
            }
          })()

          // Check if execution was skipped (e.g., trigger block not found)
          if ('skip' in executionSuccess && executionSuccess.skip) {
            runningExecutions.delete(schedule.workflowId)
            continue
          }

          if (executionSuccess.success) {
            logger.info(`[${requestId}] Workflow ${schedule.workflowId} executed successfully`)

            const nextRunAt = calculateNextRunTime(schedule, executionSuccess.blocks)

            logger.debug(
              `[${requestId}] Calculated next run time: ${nextRunAt.toISOString()} for workflow ${schedule.workflowId}`
            )

            try {
              await db
                .update(workflowSchedule)
                .set({
                  lastRanAt: now,
                  updatedAt: now,
                  nextRunAt,
                  failedCount: 0, // Reset failure count on success
                })
                .where(eq(workflowSchedule.id, schedule.id))

              logger.debug(
                `[${requestId}] Updated next run time for workflow ${schedule.workflowId} to ${nextRunAt.toISOString()}`
              )
            } catch (updateError) {
              logger.error(`[${requestId}] Error updating schedule after success:`, updateError)
            }
          } else {
            logger.warn(`[${requestId}] Workflow ${schedule.workflowId} execution failed`)

            const newFailedCount = (schedule.failedCount || 0) + 1
            const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
            const nextRunAt = calculateNextRunTime(schedule, executionSuccess.blocks)

            if (shouldDisable) {
              logger.warn(
                `[${requestId}] Disabling schedule for workflow ${schedule.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
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
                .where(eq(workflowSchedule.id, schedule.id))

              logger.debug(`[${requestId}] Updated schedule after failure`)
            } catch (updateError) {
              logger.error(`[${requestId}] Error updating schedule after failure:`, updateError)
            }
          }
        } catch (error: any) {
          // Handle sync queue overload
          if (error.message?.includes('Service overloaded')) {
            logger.warn(`[${requestId}] Service overloaded, retrying schedule in 5 minutes`)

            const retryDelay = 5 * 60 * 1000 // 5 minutes
            const nextRetryAt = new Date(now.getTime() + retryDelay)

            try {
              await db
                .update(workflowSchedule)
                .set({
                  updatedAt: now,
                  nextRunAt: nextRetryAt,
                })
                .where(eq(workflowSchedule.id, schedule.id))

              logger.debug(`[${requestId}] Updated schedule retry time due to service overload`)
            } catch (updateError) {
              logger.error(
                `[${requestId}] Error updating schedule for service overload:`,
                updateError
              )
            }
          } else {
            logger.error(
              `[${requestId}] Error executing scheduled workflow ${schedule.workflowId}`,
              error
            )

            // Ensure we create a log entry for this failed execution
            try {
              const failureLoggingSession = new LoggingSession(
                schedule.workflowId,
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
                .where(eq(workflow.id, schedule.workflowId))
                .limit(1)

              if (workflowRecord?.isDeployed) {
                try {
                  const deployedData = await loadDeployedWorkflowState(schedule.workflowId)
                  nextRunAt = calculateNextRunTime(schedule, deployedData.blocks as any)
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
              nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24 hours as a fallback
            }

            const newFailedCount = (schedule.failedCount || 0) + 1
            const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

            if (shouldDisable) {
              logger.warn(
                `[${requestId}] Disabling schedule for workflow ${schedule.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
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
                .where(eq(workflowSchedule.id, schedule.id))

              logger.debug(`[${requestId}] Updated schedule after execution error`)
            } catch (updateError) {
              logger.error(
                `[${requestId}] Error updating schedule after execution error:`,
                updateError
              )
            }
          }
        } finally {
          runningExecutions.delete(schedule.workflowId)
        }
      } catch (error: any) {
        logger.error(`[${requestId}] Error in scheduled execution handler`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error in scheduled execution handler`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    message: 'Scheduled workflow executions processed',
    executedCount: dueSchedules.length,
  })
}
