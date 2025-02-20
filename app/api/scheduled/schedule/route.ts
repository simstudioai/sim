import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { BlockState } from '@/stores/workflow/types'
import { db } from '@/db'
import { workflow, workflowSchedule } from '@/db/schema'

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
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, state } = ScheduleRequestSchema.parse(body)

    // Find the starter block to check if it's configured for scheduling
    const starterBlock = Object.values(state.blocks).find(
      (block: any) => block.type === 'starter'
    ) as BlockState | undefined

    if (!starterBlock) {
      return NextResponse.json({ error: 'No starter block found in workflow' }, { status: 400 })
    }

    const startWorkflow = getSubBlockValue(starterBlock, 'startWorkflow')

    // If the workflow is not scheduled, delete any existing schedule
    if (startWorkflow !== 'schedule') {
      await db.delete(workflowSchedule).where(eq(workflowSchedule.workflowId, workflowId))

      return NextResponse.json({ message: 'Schedule removed' })
    }

    // Get schedule configuration from starter block
    const scheduleType = getSubBlockValue(starterBlock, 'scheduleType')

    // Calculate initial next run time based on schedule type
    let cronExpression: string | null = null
    let nextRunAt = new Date()

    switch (scheduleType) {
      case 'minutes': {
        const interval = parseInt(getSubBlockValue(starterBlock, 'minutesInterval') || '15')
        const startingAt = getSubBlockValue(starterBlock, 'minutesStartingAt')
        if (startingAt) {
          const [hours, minutes] = startingAt.split(':')
          nextRunAt.setHours(parseInt(hours), parseInt(minutes), 0, 0)
          while (nextRunAt <= new Date()) {
            nextRunAt.setMinutes(nextRunAt.getMinutes() + interval)
          }
        } else {
          nextRunAt.setMinutes(nextRunAt.getMinutes() + interval)
        }
        cronExpression = `*/${interval} * * * *`
        break
      }
      case 'hourly': {
        const minute = parseInt(getSubBlockValue(starterBlock, 'hourlyMinute') || '0')
        nextRunAt.setHours(nextRunAt.getHours() + 1, minute, 0, 0)
        cronExpression = `${minute} * * * *`
        break
      }
      case 'daily': {
        const [hours, minutes] = getSubBlockValue(starterBlock, 'dailyTime').split(':')
        nextRunAt.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
        if (nextRunAt <= new Date()) {
          nextRunAt.setDate(nextRunAt.getDate() + 1)
        }
        cronExpression = `${minutes || '0'} ${hours || '9'} * * *`
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
        nextRunAt.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
        while (nextRunAt.getDay() !== targetDay || nextRunAt <= new Date()) {
          nextRunAt.setDate(nextRunAt.getDate() + 1)
        }
        cronExpression = `${minutes || '0'} ${hours || '9'} * * ${targetDay}`
        break
      }
      case 'monthly': {
        const day = parseInt(getSubBlockValue(starterBlock, 'monthlyDay') || '1')
        const [hours, minutes] = getSubBlockValue(starterBlock, 'monthlyTime').split(':')
        nextRunAt.setDate(day)
        nextRunAt.setHours(parseInt(hours || '9'), parseInt(minutes || '0'), 0, 0)
        if (nextRunAt <= new Date()) {
          nextRunAt.setMonth(nextRunAt.getMonth() + 1)
        }
        cronExpression = `${minutes || '0'} ${hours || '9'} ${day} * *`
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
        // The execute-workflows endpoint will handle custom cron calculation
        nextRunAt = new Date()
        nextRunAt.setMinutes(nextRunAt.getMinutes() + 1) // Start in 1 minute
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid schedule type' }, { status: 400 })
    }

    // Upsert the schedule
    await db
      .insert(workflowSchedule)
      .values({
        id: crypto.randomUUID(),
        workflowId,
        cronExpression,
        nextRunAt,
        triggerType: 'schedule',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workflowSchedule.workflowId],
        set: {
          cronExpression,
          nextRunAt,
          updatedAt: new Date(),
        },
      })

    return NextResponse.json({
      message: 'Schedule updated',
      nextRunAt,
      cronExpression,
    })
  } catch (error) {
    console.error('Error updating workflow schedule:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update workflow schedule' }, { status: 500 })
  }
}
