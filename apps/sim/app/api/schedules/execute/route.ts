import { Cron } from 'croner'
import { and, eq, lte, not, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionError } from '@/lib/logs/execution-logger'
import { enhancedExecutionLogger } from '@/lib/logs/enhanced-execution-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
} from '@/lib/schedules/utils'
import { checkServerSideUsageLimits } from '@/lib/usage-monitor'
import { decryptSecret } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { db } from '@/db'
import { environment as environmentTable, userStats, workflow, workflowSchedule } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

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

export async function GET() {
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

        // Load workflow data from normalized tables (no fallback to deprecated state column)
        logger.debug(
          `[${requestId}] Loading workflow ${schedule.workflowId} from normalized tables`
        )
        const normalizedData = await loadWorkflowFromNormalizedTables(schedule.workflowId)

        if (!normalizedData) {
          logger.error(
            `[${requestId}] No normalized data found for scheduled workflow ${schedule.workflowId}`
          )
          throw new Error(`Workflow data not found in normalized tables for ${schedule.workflowId}`)
        }

        // Use normalized data only
        const blocks = normalizedData.blocks
        const edges = normalizedData.edges
        const loops = normalizedData.loops
        const parallels = normalizedData.parallels
        logger.info(
          `[${requestId}] Loaded scheduled workflow ${schedule.workflowId} from normalized tables`
        )

        const mergedStates = mergeSubblockState(blocks)

        // Retrieve environment variables for this user (if any).
        const [userEnv] = await db
          .select()
          .from(environmentTable)
          .where(eq(environmentTable.userId, workflowRecord.userId))
          .limit(1)

        if (!userEnv) {
          logger.debug(
            `[${requestId}] No environment record found for user ${workflowRecord.userId}. Proceeding with empty variables.`
          )
        }

        const variables = EnvVarsSchema.parse(userEnv?.variables ?? {})

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

        const serializedWorkflow = new Serializer().serializeWorkflow(
          mergedStates,
          edges,
          loops,
          parallels
        )

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

        // Start enhanced logging
        const trigger = {
          type: 'schedule' as const,
          source: 'schedule',
          timestamp: new Date().toISOString(),
        }

        const environment = {
          variables: variables || {},
          workflowId: schedule.workflowId,
          executionId,
          userId: workflowRecord.userId,
          workspaceId: workflowRecord.workspaceId || '',
        }

        // Create workflow state from the current workflow data
        const state = (workflowRecord.state as any) || {}
        const workflowState = {
          blocks: state.blocks || {},
          edges: state.edges || [],
          loops: state.loops || {},
          parallels: state.parallels || {},
        }

        try {
          await enhancedExecutionLogger.startWorkflowExecution({
            workflowId: schedule.workflowId,
            executionId,
            trigger,
            environment,
            workflowState,
          })

          logger.debug(`[${requestId}] Started enhanced logging for scheduled execution ${executionId}`)
        } catch (enhancedError) {
          logger.error(`[${requestId}] Failed to start enhanced logging:`, enhancedError)
          // Continue with execution even if enhanced logging fails
        }

        const executor = new Executor(
          serializedWorkflow,
          processedBlockStates,
          decryptedEnvVars,
          input,
          workflowVariables
        )

        // Set the enhanced logger for block-level logging
        executor.setEnhancedLogger(enhancedExecutionLogger, executionId)
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

        // Log individual block executions to enhanced system
        if (executionResult.logs && Array.isArray(executionResult.logs)) {
          for (const blockLog of executionResult.logs) {
            try {
              // Extract cost data from block output
              let blockCost = undefined
              if (blockLog.output?.response?.cost) {
                const cost = blockLog.output.response.cost
                blockCost = {
                  input: Number(cost.input) || 0,
                  output: Number(cost.output) || 0,
                  total: Number(cost.total) || 0,
                  tokens: {
                    prompt: blockLog.output.response.tokens?.prompt || 0,
                    completion: blockLog.output.response.tokens?.completion || 0,
                    total: blockLog.output.response.tokens?.total || 0,
                  },
                  model: blockLog.output.response.model || '',
                  pricing: cost.pricing || {},
                }
              }

              await enhancedExecutionLogger.logBlockExecution({
                executionId,
                workflowId: schedule.workflowId,
                blockId: blockLog.blockId,
                blockName: blockLog.blockName || '',
                blockType: blockLog.blockType || 'unknown',
                input: blockLog.input || {},
                output: blockLog.output || {},
                timing: {
                  startedAt: blockLog.startedAt,
                  endedAt: blockLog.endedAt || blockLog.startedAt,
                  durationMs: blockLog.durationMs || 0,
                },
                status: blockLog.success ? 'success' : 'error',
                error: blockLog.success ? undefined : {
                  message: blockLog.error || 'Block execution failed',
                  stackTrace: undefined,
                },
                cost: blockCost,
                metadata: {
                  toolCalls: (blockLog as any).toolCalls || [],
                },
              })
            } catch (blockLogError) {
              logger.error(`[${requestId}] Failed to log block execution ${blockLog.blockId}:`, blockLogError)
            }
          }
        }

        // Complete enhanced logging
        try {
          // Calculate block stats from execution result
          const blockStats = {
            total: executionResult.logs?.length || 0,
            success: executionResult.logs?.filter(log => log.success).length || 0,
            error: executionResult.logs?.filter(log => !log.success).length || 0,
            skipped: 0, // TODO: Add skipped block tracking
          }

          // Extract cost data from execution logs
          const costSummary = {
            totalCost: 0,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
          }

          // Aggregate costs from all blocks
          if (executionResult.logs && Array.isArray(executionResult.logs)) {
            for (const blockLog of executionResult.logs) {
              if (blockLog.output?.response?.cost) {
                const cost = blockLog.output.response.cost
                costSummary.totalCost += Number(cost.total) || 0
                costSummary.totalInputCost += Number(cost.input) || 0
                costSummary.totalOutputCost += Number(cost.output) || 0

                if (blockLog.output.response.tokens) {
                  const tokens = blockLog.output.response.tokens
                  costSummary.totalTokens += tokens.total || 0
                  costSummary.totalPromptTokens += tokens.prompt || 0
                  costSummary.totalCompletionTokens += tokens.completion || 0
                }
              }
            }
          }

          await enhancedExecutionLogger.completeWorkflowExecution({
            executionId,
            endedAt: new Date().toISOString(),
            totalDurationMs: totalDuration || 0,
            blockStats,
            costSummary: {
              totalCost: costSummary.totalCost,
              totalInputCost: costSummary.totalInputCost,
              totalOutputCost: costSummary.totalOutputCost,
              totalTokens: costSummary.totalTokens,
              primaryModel: '', // No longer used
            },
            finalOutput: executionResult.output || {},
            traceSpans: (traceSpans || []) as any,
          })

          logger.debug(`[${requestId}] Completed enhanced logging for scheduled execution ${executionId}`)
        } catch (enhancedError) {
          logger.error(`[${requestId}] Failed to complete enhanced logging:`, enhancedError)
        }

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

        // Complete enhanced logging with error
        try {
          const blockStats = {
            total: 0,
            success: 0,
            error: 1,
            skipped: 0,
          }

          const costSummary = {
            totalCost: 0,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            primaryModel: '',
          }

          await enhancedExecutionLogger.completeWorkflowExecution({
            executionId,
            endedAt: new Date().toISOString(),
            totalDurationMs: 0,
            blockStats,
            costSummary,
            finalOutput: null,
            traceSpans: [],
          })
        } catch (enhancedError) {
          logger.error(`[${requestId}] Failed to complete enhanced logging for error:`, enhancedError)
        }

        let nextRunAt: Date
        try {
          const [workflowRecord] = await db
            .select()
            .from(workflow)
            .where(eq(workflow.id, schedule.workflowId))
            .limit(1)

          if (workflowRecord) {
            const normalizedData = await loadWorkflowFromNormalizedTables(schedule.workflowId)

            if (!normalizedData) {
              nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
            } else {
              nextRunAt = calculateNextRunTime(schedule, normalizedData.blocks)
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
