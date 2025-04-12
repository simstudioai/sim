import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { BlockState } from '@/stores/workflows/workflow/types'
import { db } from '@/db'
import { workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduledScheduleAPI')

interface SubBlockValue {
  value: string
}

function getSubBlockValue(block: BlockState, id: string): string {
  const subBlock = block.subBlocks[id] as SubBlockValue | undefined
  return subBlock?.value || ''
}

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

    // Check if there's a valid schedule configuration
    const hasScheduleConfig = (() => {
      const getValue = (id: string): string => {
        const value = getSubBlockValue(starterBlock, id)
        return value && value.trim() !== '' ? value : ''
      }

      if (scheduleType === 'minutes' && getValue('minutesInterval')) {
        return true
      }
      if (scheduleType === 'hourly' && getValue('hourlyMinute') !== '') {
        return true
      }
      if (scheduleType === 'daily' && getValue('dailyTime')) {
        return true
      }
      if (scheduleType === 'weekly' && getValue('weeklyDay') && getValue('weeklyDayTime')) {
        return true
      }
      if (scheduleType === 'monthly' && getValue('monthlyDay') && getValue('monthlyTime')) {
        return true
      }
      if (scheduleType === 'custom' && getValue('cronExpression')) {
        return true
      }
      return false
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

    // Calculate cron expression based on schedule type
    let cronExpression: string | null = null
    let shouldUpdateNextRunAt = false
    let nextRunAt: Date | undefined

    // First check if there's an existing schedule
    const existingSchedule = await db
      .select()
      .from(workflowSchedule)
      .where(eq(workflowSchedule.workflowId, workflowId))
      .limit(1)

    switch (scheduleType) {
      case 'minutes': {
        const interval = parseInt(getSubBlockValue(starterBlock, 'minutesInterval') || '15')
        cronExpression = `*/${interval} * * * *`

        // Always update nextRunAt when schedule is edited
        shouldUpdateNextRunAt = true
          
        // Get the scheduleTime value (e.g., "12:30")
        const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')
          
        // Get the current date
        nextRunAt = new Date()
        
        if (scheduleTime) {
            // Parse the time (HH:MM format)
            const [hours, minutes] = scheduleTime.split(':').map(Number)
            
            // Set the hours and minutes from scheduleTime
            nextRunAt.setHours(hours, minutes, 0, 0)
            
            // If the time is in the past, add the interval to get the next occurrence
            while (nextRunAt <= new Date()) {
              nextRunAt.setMinutes(nextRunAt.getMinutes() + interval)
            }
          } else {
            // If no time specified, round to the next interval boundary
            const now = new Date()
            const currentMinutes = now.getMinutes()
            const nextIntervalBoundary = Math.ceil(currentMinutes / interval) * interval
            nextRunAt = new Date(now)
            nextRunAt.setMinutes(nextIntervalBoundary, 0, 0)
            
            // If we're already past this time, add another interval
            if (nextRunAt <= now) {
              nextRunAt.setMinutes(nextRunAt.getMinutes() + interval)
            }
          }
        break
      }
      case 'hourly': {
        const minute = parseInt(getSubBlockValue(starterBlock, 'hourlyMinute') || '0')
        cronExpression = `${minute} * * * *`

        // Always update nextRunAt when schedule is edited
        shouldUpdateNextRunAt = true
          
        // Get schedule time if specified
        const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')
        nextRunAt = new Date()
        
        if (scheduleTime) {
          // Set the initial hour from scheduleTime, but use the minute from hourlyMinute
          const [hours] = scheduleTime.split(':').map(Number)
          nextRunAt.setHours(hours, minute, 0, 0)
          
          // If in the past, find the next hour that's in the future
          while (nextRunAt <= new Date()) {
            nextRunAt.setHours(nextRunAt.getHours() + 1)
          }
        } else {
          // Standard approach - current hour + 1, with specified minute
          nextRunAt.setHours(nextRunAt.getHours() + 1, minute, 0, 0)
        }
        break
      }
      case 'daily': {
        // First check the dailyTime as the primary source of time
        let dailyHours = 9, dailyMinutes = 0;
        const dailyTime = getSubBlockValue(starterBlock, 'dailyTime')
        
        if (dailyTime && dailyTime.includes(':')) {
          const [hours, minutes] = dailyTime.split(':').map(Number)
          dailyHours = hours
          dailyMinutes = minutes
        }
        
        // Set the cron expression
        cronExpression = `${dailyMinutes} ${dailyHours} * * *`

        // Always update nextRunAt when schedule is edited
        shouldUpdateNextRunAt = true
        nextRunAt = new Date()
          
        // Check if there's a specific scheduleTime to respect
        const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')
          
        if (scheduleTime && scheduleTime.includes(':')) {
          // Override with scheduleTime if available
          const [scheduleHours, scheduleMinutes] = scheduleTime.split(':').map(Number)
          nextRunAt.setHours(scheduleHours, scheduleMinutes, 0, 0)
        } else {
          // Otherwise use the dailyTime values
          nextRunAt.setHours(dailyHours, dailyMinutes, 0, 0)
        }
        
        // If the time is already passed for today, schedule for tomorrow
        if (nextRunAt <= new Date()) {
          nextRunAt.setDate(nextRunAt.getDate() + 1)
        }
        break
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
        
        // Get the weekly day and time
        const targetDay = dayMap[getSubBlockValue(starterBlock, 'weeklyDay') || 'MON']
        let weeklyHours = 9, weeklyMinutes = 0;
        
        const weeklyDayTime = getSubBlockValue(starterBlock, 'weeklyDayTime')
        if (weeklyDayTime && weeklyDayTime.includes(':')) {
          const [hours, minutes] = weeklyDayTime.split(':').map(Number)
          weeklyHours = hours
          weeklyMinutes = minutes
        }
        
        cronExpression = `${weeklyMinutes} ${weeklyHours} * * ${targetDay}`

        // Always update nextRunAt when schedule is edited
        shouldUpdateNextRunAt = true
        nextRunAt = new Date()
          
        // Always check for scheduleTime, not just for first run
        const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')
        if (scheduleTime && scheduleTime.includes(':')) {
          const [scheduleHours, scheduleMinutes] = scheduleTime.split(':').map(Number)
          weeklyHours = scheduleHours
          weeklyMinutes = scheduleMinutes
        }
          
        nextRunAt.setHours(weeklyHours, weeklyMinutes, 0, 0)
        
        // Keep adding days until we reach the target day in the future
        while (nextRunAt.getDay() !== targetDay || nextRunAt <= new Date()) {
          nextRunAt.setDate(nextRunAt.getDate() + 1)
        }
        break
      }
      case 'monthly': {
        const day = parseInt(getSubBlockValue(starterBlock, 'monthlyDay') || '1')
        
        // Get monthly time 
        let monthlyHours = 9, monthlyMinutes = 0;
        const monthlyTime = getSubBlockValue(starterBlock, 'monthlyTime')
        
        if (monthlyTime && monthlyTime.includes(':')) {
          const [hours, minutes] = monthlyTime.split(':').map(Number)
          monthlyHours = hours
          monthlyMinutes = minutes
        }
        
        cronExpression = `${monthlyMinutes} ${monthlyHours} ${day} * *`

        // Always update nextRunAt when schedule is edited
        shouldUpdateNextRunAt = true
        nextRunAt = new Date()
          
        // Always check for scheduleTime, not just for first run
        const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')
        if (scheduleTime && scheduleTime.includes(':')) {
          const [scheduleHours, scheduleMinutes] = scheduleTime.split(':').map(Number)
          monthlyHours = scheduleHours
          monthlyMinutes = scheduleMinutes
        }
          
        nextRunAt.setDate(day)
        nextRunAt.setHours(monthlyHours, monthlyMinutes, 0, 0)
        
        // If the date is in the past, move to next month
        if (nextRunAt <= new Date()) {
          nextRunAt.setMonth(nextRunAt.getMonth() + 1)
        }
        break
      }
      case 'custom': {
        cronExpression = getSubBlockValue(starterBlock, 'cronExpression')
        if (!cronExpression) {
          return NextResponse.json(
            { error: 'No cron expression provided for custom schedule' },
            { status: 400 }
          )
        }

        if (!existingSchedule[0] || existingSchedule[0].cronExpression !== cronExpression) {
          shouldUpdateNextRunAt = true
          nextRunAt = new Date()
          nextRunAt.setMinutes(nextRunAt.getMinutes() + 1)
        }
        break
      }
      default:
        logger.warn(`[${requestId}] Invalid schedule type: ${scheduleType}`)
        return NextResponse.json({ error: 'Invalid schedule type' }, { status: 400 })
    }

    // Prepare the values for upsert
    const values: any = {
      id: crypto.randomUUID(),
      workflowId,
      cronExpression,
      triggerType: 'schedule',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Only include next_run_at if it should be updated
    if (shouldUpdateNextRunAt && nextRunAt) {
      values.nextRunAt = nextRunAt
    }

    // Prepare the set values for update
    const setValues: any = {
      cronExpression,
      updatedAt: new Date(),
    }

    // Only include next_run_at in the update if it should be updated
    if (shouldUpdateNextRunAt && nextRunAt) {
      setValues.nextRunAt = nextRunAt
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
      nextRunAt: shouldUpdateNextRunAt
        ? nextRunAt?.toISOString()
        : existingSchedule[0]?.nextRunAt?.toISOString(),
      cronExpression,
    })

    return NextResponse.json({
      message: 'Schedule updated',
      nextRunAt: shouldUpdateNextRunAt ? nextRunAt : existingSchedule[0]?.nextRunAt,
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
