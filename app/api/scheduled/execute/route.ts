import { NextRequest, NextResponse } from 'next/server'
import { Cron } from 'croner'
import { eq, lte } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { persistLog } from '@/lib/logging'
import { decryptSecret } from '@/lib/utils'
import { BlockState, WorkflowState } from '@/stores/workflow/types'
import { mergeSubblockState } from '@/stores/workflow/utils'
import { db } from '@/db'
import { environment, workflow, workflowSchedule } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'

interface SubBlockValue {
  value: string
}

function getSubBlockValue(block: BlockState, id: string): string {
  const subBlock = block.subBlocks[id] as SubBlockValue | undefined
  return subBlock?.value || ''
}

function calculateNextRunTime(
  schedule: typeof workflowSchedule.$inferSelect,
  blocks: Record<string, BlockState>
): Date {
  // Find the starter block
  const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
  if (!starterBlock) throw new Error('No starter block found')

  const scheduleType = getSubBlockValue(starterBlock, 'scheduleType')

  switch (scheduleType) {
    case 'minutes': {
      const interval = parseInt(getSubBlockValue(starterBlock, 'minutesInterval') || '15')
      // If this is the first run and we have a starting time preference
      const startingAt = getSubBlockValue(starterBlock, 'minutesStartingAt')
      if (!schedule.lastRanAt && startingAt) {
        const [hours, minutes] = startingAt.split(':')
        const startTime = new Date()
        startTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
        // If start time is in the past, add interval until it's in the future
        while (startTime <= new Date()) {
          startTime.setMinutes(startTime.getMinutes() + interval)
        }
        return startTime
      }
      // For subsequent runs, just add the interval to the last run
      const nextRun = new Date(schedule.lastRanAt || new Date())
      nextRun.setMinutes(nextRun.getMinutes() + interval)
      return nextRun
    }
    case 'hourly': {
      const minute = parseInt(getSubBlockValue(starterBlock, 'hourlyMinute') || '0')
      const nextRun = new Date()
      nextRun.setHours(nextRun.getHours() + 1, minute, 0, 0)
      return nextRun
    }
    case 'daily': {
      const [hours, minutes] = getSubBlockValue(starterBlock, 'dailyTime').split(':')
      const nextRun = new Date()
      nextRun.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
      if (nextRun <= new Date()) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
      return nextRun
    }
    case 'weekly': {
      const dayMap: Record<string, number> = {
        MON: 1,
        TUE: 2,
        WED: 3,
        THU: 4,
        FRI: 5,
        SAT: 6,
        SUN: 0,
      }
      const targetDay = dayMap[getSubBlockValue(starterBlock, 'weeklyDay') || 'MON']
      const [hours, minutes] = getSubBlockValue(starterBlock, 'weeklyDayTime').split(':')
      const nextRun = new Date()
      nextRun.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)

      while (nextRun.getDay() !== targetDay || nextRun <= new Date()) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
      return nextRun
    }
    case 'monthly': {
      const day = parseInt(getSubBlockValue(starterBlock, 'monthlyDay') || '1')
      const [hours, minutes] = getSubBlockValue(starterBlock, 'monthlyTime').split(':')
      const nextRun = new Date()
      nextRun.setDate(day)
      nextRun.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
      if (nextRun <= new Date()) {
        nextRun.setMonth(nextRun.getMonth() + 1)
      }
      return nextRun
    }
    case 'custom': {
      const cronExpression = getSubBlockValue(starterBlock, 'cronExpression')
      if (!cronExpression) throw new Error('No cron expression provided')

      // Create a new cron instance with the expression
      const cron = new Cron(cronExpression)

      // Get the next occurrence after now
      const nextDate = cron.nextRun()
      if (!nextDate) throw new Error('Invalid cron expression or no future occurrences')

      return nextDate
    }
    default:
      throw new Error(`Unsupported schedule type: ${scheduleType}`)
  }
}

// Define the schema for environment variables
const EnvVarsSchema = z.record(z.string())

export const config = {
  runtime: 'edge',
  schedule: '*/1 * * * *',
}

// Keep track of running executions to prevent overlap
const runningExecutions = new Set<string>()

// Add GET handler for cron job
export async function GET(req: NextRequest) {
  const now = new Date()

  // Query schedules due for execution
  const dueSchedules = await db
    .select()
    .from(workflowSchedule)
    .where(lte(workflowSchedule.nextRunAt, now))
    // Limit to 10 workflows per minute to prevent overload
    .limit(10)

  for (const schedule of dueSchedules) {
    try {
      // Skip if this workflow is already running
      if (runningExecutions.has(schedule.workflowId)) {
        console.log(`Skipping workflow ${schedule.workflowId} - already running`)
        continue
      }

      runningExecutions.add(schedule.workflowId)

      // Retrieve the workflow record
      const [workflowRecord] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.id, schedule.workflowId))
        .limit(1)

      if (!workflowRecord) {
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
                      console.error('Error decrypting value:', error)
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
          console.error(`Failed to decrypt ${key}:`, error)
          throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
        }
      }

      // Serialize and execute the workflow
      const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)
      const executor = new Executor(serializedWorkflow, currentBlockStates, decryptedEnvVars)
      const executionId = uuidv4()
      const result = await executor.execute(schedule.workflowId)

      // Log each execution step
      for (const log of result.logs || []) {
        await persistLog({
          id: uuidv4(),
          workflowId: schedule.workflowId,
          executionId,
          level: log.success ? 'info' : 'error',
          message: `Block ${log.blockName || log.blockId} (${log.blockType}): ${
            log.error || `Completed successfully`
          }`,
          duration: log.success ? `${log.durationMs}ms` : 'NA',
          createdAt: new Date(log.endedAt || log.startedAt),
        })
      }

      // Calculate total duration from successful block logs
      const totalDuration = (result.logs || [])
        .filter((log) => log.success)
        .reduce((sum, log) => sum + log.durationMs, 0)

      // Log the final execution result
      await persistLog({
        id: uuidv4(),
        workflowId: schedule.workflowId,
        executionId,
        level: result.success ? 'info' : 'error',
        message: result.success
          ? 'Scheduled workflow executed successfully'
          : `Scheduled workflow execution failed: ${result.error}`,
        duration: result.success ? `${totalDuration}ms` : 'NA',
        createdAt: new Date(),
      })

      // Calculate the next run time based on the schedule configuration
      const nextRunAt = calculateNextRunTime(schedule, blocks)

      // Update the schedule with the next run time
      await db
        .update(workflowSchedule)
        .set({
          lastRanAt: now,
          updatedAt: now,
          nextRunAt,
        })
        .where(eq(workflowSchedule.id, schedule.id))
    } catch (error: any) {
      await persistLog({
        id: uuidv4(),
        workflowId: schedule.workflowId,
        executionId: uuidv4(),
        level: 'error',
        message: error.message || 'Unknown error during scheduled workflow execution',
        createdAt: new Date(),
      })
    } finally {
      runningExecutions.delete(schedule.workflowId)
    }
  }

  return NextResponse.json({
    message: 'Scheduled workflow executions processed',
    executedCount: dueSchedules.length,
  })
}
