import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { 
  getScheduleTimeValues,
  getSubBlockValue, 
  generateCronExpression, 
  calculateNextRunTime,
  BlockState
} from '@/lib/schedules/utils'
import { db } from '@/db'
import { workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduledScheduleAPI')

// Schema for schedule request
const ScheduleRequestSchema = z.object({
  workflowId: z.string(),
  state: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()),
  }),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, state } = ScheduleRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing schedule update for workflow ${workflowId}`)

    // Find the starter block to check if it's configured for scheduling
    const starterBlock = Object.values(state.blocks).find(
      (block: any) => block.type === 'starter'
    ) as BlockState | undefined

    if (!starterBlock) {
      logger.warn(`[${requestId}] No starter block found in workflow ${workflowId}`)
      return NextResponse.json({ error: 'No starter block found in workflow' }, { status: 400 })
    }

    const startWorkflow = getSubBlockValue(starterBlock, 'startWorkflow')
    const scheduleType = getSubBlockValue(starterBlock, 'scheduleType')

    // Check if there's a valid schedule configuration using the helper function
    const scheduleValues = getScheduleTimeValues(starterBlock)
    
    // Determine if there's a valid schedule configuration
    const hasScheduleConfig = (() => {
      switch (scheduleType) {
        case 'minutes':
          return !!scheduleValues.minutesInterval
        case 'hourly':
          return scheduleValues.hourlyMinute !== undefined
        case 'daily':
          return !!scheduleValues.dailyTime[0] || !!scheduleValues.dailyTime[1]
        case 'weekly':
          return !!scheduleValues.weeklyDay && (!!scheduleValues.weeklyTime[0] || !!scheduleValues.weeklyTime[1])
        case 'monthly':
          return !!scheduleValues.monthlyDay && (!!scheduleValues.monthlyTime[0] || !!scheduleValues.monthlyTime[1])
        case 'custom':
          return !!getSubBlockValue(starterBlock, 'cronExpression')
        default:
          return false
      }
    })()

    // If the workflow is not configured for scheduling, delete any existing schedule
    if (startWorkflow !== 'schedule' && !hasScheduleConfig) {
      logger.info(
        `[${requestId}] Removing schedule for workflow ${workflowId} - no valid configuration found`
      )
      await db.delete(workflowSchedule).where(eq(workflowSchedule.workflowId, workflowId))

      return NextResponse.json({ message: 'Schedule removed' })
    }

    // If we're here, we either have startWorkflow === 'schedule' or hasScheduleConfig is true
    if (startWorkflow !== 'schedule') {
      logger.info(
        `[${requestId}] Setting workflow to scheduled mode based on schedule configuration`
      )
      // The UI should handle this, but as a fallback we'll assume the user intended to schedule
      // the workflow even if startWorkflow wasn't set properly
    }

    // Get schedule configuration from starter block
    logger.debug(`[${requestId}] Schedule type for workflow ${workflowId}: ${scheduleType}`)

    // First check if there's an existing schedule
    const existingSchedule = await db
      .select()
      .from(workflowSchedule)
      .where(eq(workflowSchedule.workflowId, workflowId))
      .limit(1)

    // Generate cron expression and calculate next run time
    let cronExpression: string | null = null
    let nextRunAt: Date | undefined

    try {
      // Get cron expression based on schedule type
      cronExpression = generateCronExpression(scheduleType, scheduleValues)
      
      // Always calculate next run time when schedule is created or updated
      nextRunAt = calculateNextRunTime(scheduleType, scheduleValues)
      
      logger.debug(`[${requestId}] Generated cron: ${cronExpression}, next run at: ${nextRunAt.toISOString()}`)
    } catch (error) {
      logger.error(`[${requestId}] Error generating schedule: ${error}`)
      return NextResponse.json({ error: 'Failed to generate schedule' }, { status: 400 })
    }

    // Prepare the values for upsert
    const values = {
      id: crypto.randomUUID(),
      workflowId,
      cronExpression,
      triggerType: 'schedule',
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRunAt,
    }

    // Prepare the set values for update
    const setValues = {
      cronExpression,
      updatedAt: new Date(),
      nextRunAt,
    }

    // Upsert the schedule
    await db
      .insert(workflowSchedule)
      .values(values)
      .onConflictDoUpdate({
        target: [workflowSchedule.workflowId],
        set: setValues,
      })

    logger.info(`[${requestId}] Schedule updated for workflow ${workflowId}`, {
      nextRunAt: nextRunAt?.toISOString(),
      cronExpression,
    })

    return NextResponse.json({
      message: 'Schedule updated',
      nextRunAt,
      cronExpression,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating workflow schedule`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update workflow schedule' }, { status: 500 })
  }
}
