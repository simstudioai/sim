import { NextRequest, NextResponse } from 'next/server'
import { Cron } from 'croner'
import { eq, lte } from 'drizzle-orm'
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

/**
 * Calculate the next run time for a schedule
 * This is a wrapper around the utility function in schedule-utils.ts
 */
function calculateNextRunTime(
  schedule: typeof workflowSchedule.$inferSelect,
  blocks: Record<string, BlockState>
): Date {
  // Find the starter block
  const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
  if (!starterBlock) throw new Error('No starter block found')

  // Get schedule type from the starter block
  const scheduleType = getSubBlockValue(starterBlock, 'scheduleType')

  // Get all schedule values
  const scheduleValues = getScheduleTimeValues(starterBlock)

  // If there's a cron expression, use croner to calculate next run
  if (schedule.cronExpression) {
    const cron = new Cron(schedule.cronExpression)
    const nextDate = cron.nextRun()
    if (!nextDate) throw new Error('Invalid cron expression or no future occurrences')
    return nextDate
  }

  // Calculate next run time with our helper function
  // We pass the lastRanAt from the schedule to help calculate accurate next run time
  const lastRanAt = schedule.lastRanAt ? new Date(schedule.lastRanAt) : null
  return calculateNextTime(scheduleType, scheduleValues, lastRanAt)
}

// Define the schema for environment variables
const EnvVarsSchema = z.record(z.string())

// Keep track of running executions to prevent overlap
const runningExecutions = new Set<string>()

// Add GET handler for cron job
export async function GET(req: NextRequest) {
  logger.info(`Scheduled execution triggered at ${new Date().toISOString()}`)
  const requestId = crypto.randomUUID().slice(0, 8)
  const now = new Date()

  let dueSchedules: (typeof workflowSchedule.$inferSelect)[] = []

  try {
    // Query schedules due for execution
    dueSchedules = await db
      .select()
      .from(workflowSchedule)
      .where(lte(workflowSchedule.nextRunAt, now))
      // Limit to 10 workflows per minute to prevent overload
      .limit(10)

    logger.info(`[${requestId}] Processing ${dueSchedules.length} due scheduled workflows`)

    for (const schedule of dueSchedules) {
      const executionId = uuidv4()

      try {
        // Skip if this workflow is already running
        if (runningExecutions.has(schedule.workflowId)) {
          logger.debug(`[${requestId}] Skipping workflow ${schedule.workflowId} - already running`)
          continue
        }

        runningExecutions.add(schedule.workflowId)
        logger.debug(`[${requestId}] Starting execution of workflow ${schedule.workflowId}`)

        // Retrieve the workflow record
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

        // The state in the database is exactly what we store in localStorage
        const state = workflowRecord.state as WorkflowState
        const { blocks, edges, loops } = state

        // Use the same execution flow as in use-workflow-execution.ts
        const mergedStates = mergeSubblockState(blocks)

        // Retrieve environment variables for this user
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

        // Parse and validate environment variables
        const variables = EnvVarsSchema.parse(userEnv.variables)

        // Replace environment variables in the block states
        const currentBlockStates = await Object.entries(mergedStates).reduce(
          async (accPromise, [id, block]) => {
            const acc = await accPromise
            acc[id] = await Object.entries(block.subBlocks).reduce(
              async (subAccPromise, [key, subBlock]) => {
                const subAcc = await subAccPromise
                let value = subBlock.value

                // If the value is a string and contains environment variable syntax
                if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
                  const matches = value.match(/{{([^}]+)}}/g)
                  if (matches) {
                    // Process all matches sequentially
                    for (const match of matches) {
                      const varName = match.slice(2, -2) // Remove {{ and }}
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

        // Create a map of decrypted environment variables
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

        // Serialize and execute the workflow
        const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)

        // Add workflowId to the input for OAuth credential resolution
        const input = {
          workflowId: schedule.workflowId,
        }

        // Process the block states to ensure response formats are properly parsed
        // This is crucial for agent blocks with response format
        const processedBlockStates = Object.entries(currentBlockStates).reduce(
          (acc, [blockId, blockState]) => {
            // Check if this block has a responseFormat that needs to be parsed
            if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
              try {
                logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
                // Attempt to parse the responseFormat if it's a string
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

        // Get workflow variables
        let workflowVariables = {}
        if (workflowRecord.variables) {
          try {
            // Parse workflow variables if they're stored as a string
            if (typeof workflowRecord.variables === 'string') {
              workflowVariables = JSON.parse(workflowRecord.variables)
            } else {
              // Otherwise use as is (already parsed JSON)
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
            // Continue execution even if variables can't be parsed
          }
        } else {
          logger.debug(`[${requestId}] No workflow variables found for: ${schedule.workflowId}`)
        }

        const executor = new Executor(
          serializedWorkflow,
          processedBlockStates, // Use the processed block states
          decryptedEnvVars,
          input,
          workflowVariables
        )
        const result = await executor.execute(schedule.workflowId)

        logger.info(`[${requestId}] Workflow execution completed: ${schedule.workflowId}`, {
          success: result.success,
          executionTime: result.metadata?.duration,
        })

        // Update workflow run counts if execution was successful
        if (result.success) {
          await updateWorkflowRunCounts(schedule.workflowId)

          // Track scheduled execution in user stats
          await db
            .update(userStats)
            .set({
              totalScheduledExecutions: sql`total_scheduled_executions + 1`,
              lastActive: new Date(),
            })
            .where(eq(userStats.userId, workflowRecord.userId))
        }

        // Build trace spans from execution logs
        const { traceSpans, totalDuration } = buildTraceSpans(result)

        // Add trace spans to the execution result
        const enrichedResult = {
          ...result,
          traceSpans,
          totalDuration,
        }

        // Log each execution step and the final result
        await persistExecutionLogs(schedule.workflowId, executionId, enrichedResult, 'schedule')

        // Only update next_run_at if execution was successful
        if (result.success) {
          logger.info(`[${requestId}] Workflow ${schedule.workflowId} executed successfully`)
          // Calculate the next run time based on the schedule configuration
          const nextRunAt = calculateNextRunTime(schedule, blocks)

          logger.debug(
            `[${requestId}] Calculated next run time: ${nextRunAt.toISOString()} for workflow ${schedule.workflowId}`
          )

          // Update the schedule with the next run time
          await db
            .update(workflowSchedule)
            .set({
              lastRanAt: now,
              updatedAt: now,
              nextRunAt,
            })
            .where(eq(workflowSchedule.id, schedule.id))

          logger.debug(
            `[${requestId}] Updated next run time for workflow ${schedule.workflowId} to ${nextRunAt.toISOString()}`
          )
        } else {
          logger.warn(`[${requestId}] Workflow ${schedule.workflowId} execution failed`)
          // If execution failed, increment next_run_at by a small delay to prevent immediate retries
          const retryDelay = 1 * 60 * 1000 // 1 minute delay
          const nextRetryAt = new Date(now.getTime() + retryDelay)

          await db
            .update(workflowSchedule)
            .set({
              updatedAt: now,
              nextRunAt: nextRetryAt,
            })
            .where(eq(workflowSchedule.id, schedule.id))
        }
      } catch (error: any) {
        logger.error(
          `[${requestId}] Error executing scheduled workflow ${schedule.workflowId}`,
          error
        )

        // Log the error
        await persistExecutionError(schedule.workflowId, executionId, error, 'schedule')

        // On error, increment next_run_at by a small delay to prevent immediate retries
        const retryDelay = 1 * 60 * 1000 // 1 minute delay
        const nextRetryAt = new Date(now.getTime() + retryDelay)

        await db
          .update(workflowSchedule)
          .set({
            updatedAt: now,
            nextRunAt: nextRetryAt,
          })
          .where(eq(workflowSchedule.id, schedule.id))
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
