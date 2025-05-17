import { NextRequest, NextResponse } from 'next/server'
import { Cron } from 'croner'
import { and, eq, lte, not } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionError, persistExecutionLogs } from '@/lib/logs/execution-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import {
  BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
} from '@/lib/schedules/utils'
import { checkServerSideUsageLimits } from '@/lib/usage-monitor'
import { decryptSecret } from '@/lib/utils'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { WorkflowState } from '@/stores/workflows/workflow/types'
import { db } from '@/db'
import { environment, userStats, workflow, workflowSchedule } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'

// Add dynamic export to prevent caching
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
  const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
  if (!starterBlock) throw new Error('No starter block found')
  const scheduleType = getSubBlockValue(starterBlock, 'scheduleType')
  const scheduleValues = getScheduleTimeValues(starterBlock)

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

export async function GET(req: NextRequest) {
  logger.info(`Scheduled execution triggered at ${new Date().toISOString()}`)
  const requestId = crypto.randomUUID().slice(0, 8)
  const now = new Date()

  let dueSchedules: (typeof workflowSchedule.$inferSelect)[] = []

  try {
    try {
      dueSchedules = await db
        .select()
        .from(workflowSchedule)
        .where(
          and(lte(workflowSchedule.nextRunAt, now), not(eq(workflowSchedule.status, 'disabled')))
        )
        .limit(10)

      logger.debug(`[${requestId}] Successfully queried schedules: ${dueSchedules.length} found`)
    } catch (queryError) {
      logger.error(`[${requestId}] Error in schedule query:`, queryError)
      throw queryError
    }

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

        const usageCheck = await checkServerSideUsageLimits(workflowRecord.userId)
        if (usageCheck.isExceeded) {
          logger.warn(
            `[${requestId}] User ${workflowRecord.userId} has exceeded usage limits. Skipping scheduled execution.`,
            {
              currentUsage: usageCheck.currentUsage,
              limit: usageCheck.limit,
              workflowId: schedule.workflowId,
            }
          )

          await persistExecutionError(
            schedule.workflowId,
            executionId,
            new Error(
              usageCheck.message ||
                'Usage limit exceeded. Please upgrade your plan to continue running scheduled workflows.'
            ),
            'schedule'
          )

          const retryDelay = 24 * 60 * 60 * 1000 // 24 hour delay for exceeded limits
          const nextRetryAt = new Date(now.getTime() + retryDelay)

          try {
            await db
              .update(workflowSchedule)
              .set({
                updatedAt: now,
                nextRunAt: nextRetryAt,
              })
              .where(eq(workflowSchedule.id, schedule.id))

            logger.debug(`[${requestId}] Updated next retry time due to usage limits`)
          } catch (updateError) {
            logger.error(`[${requestId}] Error updating schedule for usage limits:`, updateError)
          }

          runningExecutions.delete(schedule.workflowId)
          continue
        }

        const state = workflowRecord.state as WorkflowState
        const { blocks, edges, loops } = state

        const mergedStates = mergeSubblockState(blocks)

        const [userEnv] = await db
          .select()
          .from(environment)
          .where(eq(environment.userId, workflowRecord.userId))
          .limit(1)

        if (!userEnv) {
          logger.error(
            `[${requestId}] No environment variables found for user ${workflowRecord.userId}`
          )
          throw new Error('No environment variables found for this user')
        }

        const variables = EnvVarsSchema.parse(userEnv.variables)

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

        const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)

        const input = {
          workflowId: schedule.workflowId,
          _context: {
            workflowId: schedule.workflowId,
          },
        }

        const processedBlockStates = Object.entries(currentBlockStates).reduce(
          (acc, [blockId, blockState]) => {
            if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
              try {
                logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
                const parsedResponseFormat = JSON.parse(blockState.responseFormat)

                acc[blockId] = {
                  ...blockState,
                  responseFormat: parsedResponseFormat,
                }
              } catch (error) {
                logger.warn(
                  `[${requestId}] Failed to parse responseFormat for block ${blockId}`,
                  error
                )
                acc[blockId] = blockState
              }
            } else {
              acc[blockId] = blockState
            }
            return acc
          },
          {} as Record<string, Record<string, any>>
        )

        logger.info(`[${requestId}] Executing workflow ${schedule.workflowId}`)

        let workflowVariables = {}
        if (workflowRecord.variables) {
          try {
            if (typeof workflowRecord.variables === 'string') {
              workflowVariables = JSON.parse(workflowRecord.variables)
            } else {
              workflowVariables = workflowRecord.variables
            }
            logger.debug(
              `[${requestId}] Loaded ${Object.keys(workflowVariables).length} workflow variables for: ${schedule.workflowId}`
            )
          } catch (error) {
            logger.error(
              `[${requestId}] Failed to parse workflow variables: ${schedule.workflowId}`,
              error
            )
          }
        } else {
          logger.debug(`[${requestId}] No workflow variables found for: ${schedule.workflowId}`)
        }

        const executor = new Executor(
          serializedWorkflow,
          processedBlockStates,
          decryptedEnvVars,
          input,
          workflowVariables
        )
        const result = await executor.execute(schedule.workflowId)

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
              .where(eq(userStats.userId, workflowRecord.userId))

            logger.debug(`[${requestId}] Updated user stats for scheduled execution`)
          } catch (statsError) {
            logger.error(`[${requestId}] Error updating user stats:`, statsError)
          }
        }

        const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

        const enrichedResult = {
          ...executionResult,
          traceSpans,
          totalDuration,
        }

        await persistExecutionLogs(schedule.workflowId, executionId, enrichedResult, 'schedule')

        if (executionResult.success) {
          logger.info(`[${requestId}] Workflow ${schedule.workflowId} executed successfully`)

          const nextRunAt = calculateNextRunTime(schedule, blocks)

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
          const nextRunAt = calculateNextRunTime(schedule, blocks)

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
        logger.error(
          `[${requestId}] Error executing scheduled workflow ${schedule.workflowId}`,
          error
        )

        await persistExecutionError(schedule.workflowId, executionId, error, 'schedule')

        let nextRunAt: Date
        try {
          const [workflowRecord] = await db
            .select()
            .from(workflow)
            .where(eq(workflow.id, schedule.workflowId))
            .limit(1)

          if (workflowRecord) {
            const state = workflowRecord.state as WorkflowState
            const { blocks } = state
            nextRunAt = calculateNextRunTime(schedule, blocks)
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
          logger.error(`[${requestId}] Error updating schedule after execution error:`, updateError)
        }
      } finally {
        runningExecutions.delete(schedule.workflowId)
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
