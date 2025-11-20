import { db } from '@sim/db'
import { workflow, workflowSchedule } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  type BlockState,
  calculateNextRunTime,
  generateCronExpression,
  getScheduleTimeValues,
  getSubBlockValue,
  validateCronExpression,
} from '@/lib/schedules/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('ScheduledAPI')

const ScheduleRequestSchema = z.object({
  workflowId: z.string(),
  blockId: z.string().optional(),
  state: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()),
  }),
})

function hasValidScheduleConfig(
  scheduleType: string | undefined,
  scheduleValues: ReturnType<typeof getScheduleTimeValues>,
  starterBlock: BlockState
): boolean {
  switch (scheduleType) {
    case 'minutes':
      return !!scheduleValues.minutesInterval
    case 'hourly':
      return scheduleValues.hourlyMinute !== undefined
    case 'daily':
      return !!scheduleValues.dailyTime[0] || !!scheduleValues.dailyTime[1]
    case 'weekly':
      return (
        !!scheduleValues.weeklyDay &&
        (!!scheduleValues.weeklyTime[0] || !!scheduleValues.weeklyTime[1])
      )
    case 'monthly':
      return (
        !!scheduleValues.monthlyDay &&
        (!!scheduleValues.monthlyTime[0] || !!scheduleValues.monthlyTime[1])
      )
    case 'custom':
      return !!getSubBlockValue(starterBlock, 'cronExpression')
    default:
      return false
  }
}

/**
 * Get schedule information for a workflow
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId()
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId')
  const blockId = url.searchParams.get('blockId')
  const mode = url.searchParams.get('mode')

  if (mode && mode !== 'schedule') {
    return NextResponse.json({ schedule: null })
  }

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule query attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 })
    }

    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    let isAuthorized = workflowRecord.userId === session.user.id

    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission !== null
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Not authorized to view this workflow' }, { status: 403 })
    }

    logger.info(`[${requestId}] Getting schedule for workflow ${workflowId}`)

    const conditions = [eq(workflowSchedule.workflowId, workflowId)]
    if (blockId) {
      conditions.push(eq(workflowSchedule.blockId, blockId))
    }

    const schedule = await db
      .select()
      .from(workflowSchedule)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .limit(1)

    const headers = new Headers()
    headers.set('Cache-Control', 'no-store, max-age=0')

    if (schedule.length === 0) {
      return NextResponse.json({ schedule: null }, { headers })
    }

    const scheduleData = schedule[0]
    const isDisabled = scheduleData.status === 'disabled'
    const hasFailures = scheduleData.failedCount > 0

    return NextResponse.json(
      {
        schedule: scheduleData,
        isDisabled,
        hasFailures,
        canBeReactivated: isDisabled,
      },
      { headers }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving workflow schedule`, error)
    return NextResponse.json({ error: 'Failed to retrieve workflow schedule' }, { status: 500 })
  }
}

const saveAttempts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60000 // 1 minute
const RATE_LIMIT_MAX = 10 // 10 saves per minute

/**
 * Create or update a schedule for a workflow
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = Date.now()
    const userKey = session.user.id
    const limit = saveAttempts.get(userKey)

    if (limit && limit.resetAt > now) {
      if (limit.count >= RATE_LIMIT_MAX) {
        logger.warn(`[${requestId}] Rate limit exceeded for user: ${userKey}`)
        return NextResponse.json(
          { error: 'Too many save attempts. Please wait a moment and try again.' },
          { status: 429 }
        )
      }
      limit.count++
    } else {
      saveAttempts.set(userKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    }

    const body = await req.json()
    const { workflowId, blockId, state } = ScheduleRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing schedule update for workflow ${workflowId}`)

    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    let isAuthorized = workflowRecord.userId === session.user.id

    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission === 'write' || userPermission === 'admin'
    }

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User not authorized to modify schedule for workflow: ${workflowId}`
      )
      return NextResponse.json({ error: 'Not authorized to modify this workflow' }, { status: 403 })
    }

    let targetBlock: BlockState | undefined
    if (blockId) {
      targetBlock = Object.values(state.blocks).find((block: any) => block.id === blockId) as
        | BlockState
        | undefined
    } else {
      targetBlock = Object.values(state.blocks).find(
        (block: any) => block.type === 'starter' || block.type === 'schedule'
      ) as BlockState | undefined
    }

    if (!targetBlock) {
      logger.warn(`[${requestId}] No starter or schedule block found in workflow ${workflowId}`)
      return NextResponse.json(
        { error: 'No starter or schedule block found in workflow' },
        { status: 400 }
      )
    }

    const startWorkflow = getSubBlockValue(targetBlock, 'startWorkflow')
    const scheduleType = getSubBlockValue(targetBlock, 'scheduleType')

    const scheduleValues = getScheduleTimeValues(targetBlock)

    const hasScheduleConfig = hasValidScheduleConfig(scheduleType, scheduleValues, targetBlock)

    const isScheduleBlock = targetBlock.type === 'schedule'
    const hasValidConfig = isScheduleBlock || (startWorkflow === 'schedule' && hasScheduleConfig)

    logger.info(`[${requestId}] Schedule validation debug:`, {
      workflowId,
      blockId,
      blockType: targetBlock.type,
      isScheduleBlock,
      startWorkflow,
      scheduleType,
      hasScheduleConfig,
      hasValidConfig,
      scheduleValues: {
        minutesInterval: scheduleValues.minutesInterval,
        dailyTime: scheduleValues.dailyTime,
        cronExpression: scheduleValues.cronExpression,
      },
    })

    if (!hasValidConfig) {
      logger.info(
        `[${requestId}] Removing schedule for workflow ${workflowId} - no valid configuration found`
      )
      const deleteConditions = [eq(workflowSchedule.workflowId, workflowId)]
      if (blockId) {
        deleteConditions.push(eq(workflowSchedule.blockId, blockId))
      }

      await db
        .delete(workflowSchedule)
        .where(deleteConditions.length > 1 ? and(...deleteConditions) : deleteConditions[0])

      return NextResponse.json({ message: 'Schedule removed' })
    }

    if (isScheduleBlock) {
      logger.info(`[${requestId}] Processing schedule trigger block for workflow ${workflowId}`)
    } else if (startWorkflow !== 'schedule') {
      logger.info(
        `[${requestId}] Setting workflow to scheduled mode based on schedule configuration`
      )
    }

    logger.debug(`[${requestId}] Schedule type for workflow ${workflowId}: ${scheduleType}`)

    let cronExpression: string | null = null
    let nextRunAt: Date | undefined
    const timezone = getSubBlockValue(targetBlock, 'timezone') || 'UTC'

    try {
      const defaultScheduleType = scheduleType || 'daily'
      const scheduleStartAt = getSubBlockValue(targetBlock, 'scheduleStartAt')
      const scheduleTime = getSubBlockValue(targetBlock, 'scheduleTime')

      logger.debug(`[${requestId}] Schedule configuration:`, {
        type: defaultScheduleType,
        timezone,
        startDate: scheduleStartAt || 'not specified',
        time: scheduleTime || 'not specified',
      })

      const sanitizedScheduleValues =
        defaultScheduleType !== 'custom'
          ? { ...scheduleValues, cronExpression: null }
          : scheduleValues

      cronExpression = generateCronExpression(defaultScheduleType, sanitizedScheduleValues)

      if (cronExpression) {
        const validation = validateCronExpression(cronExpression, timezone)
        if (!validation.isValid) {
          logger.error(`[${requestId}] Invalid cron expression: ${validation.error}`, {
            scheduleType: defaultScheduleType,
            cronExpression,
          })
          return NextResponse.json(
            { error: `Invalid schedule configuration: ${validation.error}` },
            { status: 400 }
          )
        }
      }

      nextRunAt = calculateNextRunTime(defaultScheduleType, sanitizedScheduleValues)

      logger.debug(
        `[${requestId}] Generated cron: ${cronExpression}, next run at: ${nextRunAt.toISOString()}`
      )
    } catch (error: any) {
      logger.error(`[${requestId}] Error generating schedule: ${error}`)
      const errorMessage = error?.message || 'Failed to generate schedule'
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    const values = {
      id: crypto.randomUUID(),
      workflowId,
      blockId,
      cronExpression,
      triggerType: 'schedule',
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRunAt,
      timezone,
      status: 'active', // Ensure new schedules are active
      failedCount: 0, // Reset failure count for new schedules
    }

    const setValues = {
      blockId,
      cronExpression,
      updatedAt: new Date(),
      nextRunAt,
      timezone,
      status: 'active', // Reactivate if previously disabled
      failedCount: 0, // Reset failure count on reconfiguration
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(workflowSchedule)
        .values(values)
        .onConflictDoUpdate({
          target: [workflowSchedule.workflowId, workflowSchedule.blockId],
          set: setValues,
        })
    })

    logger.info(`[${requestId}] Schedule updated for workflow ${workflowId}`, {
      nextRunAt: nextRunAt?.toISOString(),
      cronExpression,
    })

    try {
      const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
      trackPlatformEvent('platform.schedule.created', {
        'workflow.id': workflowId,
        'schedule.type': scheduleType || 'daily',
        'schedule.timezone': timezone,
        'schedule.is_custom': scheduleType === 'custom',
      })
    } catch (_e) {
      // Silently fail
    }

    return NextResponse.json({
      message: 'Schedule updated',
      schedule: { id: values.id },
      nextRunAt,
      cronExpression,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error updating workflow schedule`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error?.message || 'Failed to update workflow schedule'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
