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
        const value = getSubBlockValue(starterBlock, id);
        return value && value.trim() !== '' ? value : '';
      };
      
      if (scheduleType === 'minutes' && getValue('minutesInterval')) {
        return true;
      }
      if (scheduleType === 'hourly' && getValue('hourlyMinute') !== '') {
        return true;
      }
      if (scheduleType === 'daily' && getValue('dailyTime')) {
        return true;
      }
      if (scheduleType === 'weekly' && getValue('weeklyDay') && 
          getValue('weeklyDayTime')) {
        return true;
      }
      if (scheduleType === 'monthly' && getValue('monthlyDay') && 
          getValue('monthlyTime')) {
        return true;
      }
      if (scheduleType === 'custom' && getValue('cronExpression')) {
        return true;
      }
      return false;
    })();

    // If the workflow is not configured for scheduling, delete any existing schedule
    if (startWorkflow !== 'schedule' && !hasScheduleConfig) {
      logger.info(`[${requestId}] Removing schedule for workflow ${workflowId} - no valid configuration found`)
      await db.delete(workflowSchedule).where(eq(workflowSchedule.workflowId, workflowId))

      return NextResponse.json({ message: 'Schedule removed' })
    }

    // If we're here, we either have startWorkflow === 'schedule' or hasScheduleConfig is true
    if (startWorkflow !== 'schedule') {
      logger.info(`[${requestId}] Setting workflow to scheduled mode based on schedule configuration`)
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

        // Check if we need to update next_run_at
        if (!existingSchedule[0] || existingSchedule[0].cronExpression !== cronExpression) {
          shouldUpdateNextRunAt = true
          nextRunAt = new Date()
          const startingAt = getSubBlockValue(starterBlock, 'minutesStartingAt')

          if (startingAt) {
            const [hours, minutes] = startingAt.split(':')
            nextRunAt.setHours(parseInt(hours), parseInt(minutes), 0, 0)
            while (nextRunAt <= new Date()) {
              nextRunAt.setMinutes(nextRunAt.getMinutes() + interval)
            }
          } else {
            // Round down to nearest interval boundary
            const now = new Date()
            const currentMinutes = now.getMinutes()
            const lastIntervalBoundary = Math.floor(currentMinutes / interval) * interval
            nextRunAt = new Date(now)
            nextRunAt.setMinutes(lastIntervalBoundary, 0, 0)
            while (nextRunAt <= now) {
              nextRunAt.setMinutes(nextRunAt.getMinutes() + interval)
            }
          }
        }
        break
      }
      case 'hourly': {
        const minute = parseInt(getSubBlockValue(starterBlock, 'hourlyMinute') || '0')
        cronExpression = `${minute} * * * *`

        if (!existingSchedule[0] || existingSchedule[0].cronExpression !== cronExpression) {
          shouldUpdateNextRunAt = true
          nextRunAt = new Date()
          nextRunAt.setHours(nextRunAt.getHours() + 1, minute, 0, 0)
        }
        break
      }
      case 'daily': {
        const [hours, minutes] = getSubBlockValue(starterBlock, 'dailyTime').split(':')
        cronExpression = `${minutes || '0'} ${hours || '9'} * * *`

        if (!existingSchedule[0] || existingSchedule[0].cronExpression !== cronExpression) {
          shouldUpdateNextRunAt = true
          nextRunAt = new Date()
          nextRunAt.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
          if (nextRunAt <= new Date()) {
            nextRunAt.setDate(nextRunAt.getDate() + 1)
          }
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
        const targetDay = dayMap[getSubBlockValue(starterBlock, 'weeklyDay') || 'MON']
        const [hours, minutes] = getSubBlockValue(starterBlock, 'weeklyDayTime').split(':')
        cronExpression = `${minutes || '0'} ${hours || '9'} * * ${targetDay}`

        if (!existingSchedule[0] || existingSchedule[0].cronExpression !== cronExpression) {
          shouldUpdateNextRunAt = true
          nextRunAt = new Date()
          nextRunAt.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
          while (nextRunAt.getDay() !== targetDay || nextRunAt <= new Date()) {
            nextRunAt.setDate(nextRunAt.getDate() + 1)
          }
        }
        break
      }
      case 'monthly': {
        const day = parseInt(getSubBlockValue(starterBlock, 'monthlyDay') || '1')
        const [hours, minutes] = getSubBlockValue(starterBlock, 'monthlyTime').split(':')
        cronExpression = `${minutes || '0'} ${hours || '9'} ${day} * *`

        if (!existingSchedule[0] || existingSchedule[0].cronExpression !== cronExpression) {
          shouldUpdateNextRunAt = true
          nextRunAt = new Date()
          nextRunAt.setDate(day)
          nextRunAt.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
          if (nextRunAt <= new Date()) {
            nextRunAt.setMonth(nextRunAt.getMonth() + 1)
          }
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
