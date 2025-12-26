import { db } from '@sim/db'
import { workflow, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { validateCronExpression } from '@/lib/workflows/schedules/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

const scheduleUpdateSchema = z.object({
  action: z.literal('reactivate'),
})

/**
 * Reactivate a disabled schedule
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const { id: scheduleId } = await params
    logger.debug(`[${requestId}] Reactivating schedule with ID: ${scheduleId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validation = scheduleUpdateSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const [schedule] = await db
      .select({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        status: workflowSchedule.status,
        cronExpression: workflowSchedule.cronExpression,
        timezone: workflowSchedule.timezone,
      })
      .from(workflowSchedule)
      .where(eq(workflowSchedule.id, scheduleId))
      .limit(1)

    if (!schedule) {
      logger.warn(`[${requestId}] Schedule not found: ${scheduleId}`)
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, schedule.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow not found for schedule: ${scheduleId}`)
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
      logger.warn(`[${requestId}] User not authorized to modify this schedule: ${scheduleId}`)
      return NextResponse.json({ error: 'Not authorized to modify this schedule' }, { status: 403 })
    }

    if (schedule.status === 'active') {
      return NextResponse.json({ message: 'Schedule is already active' }, { status: 200 })
    }

    if (!schedule.cronExpression) {
      logger.error(`[${requestId}] Schedule has no cron expression: ${scheduleId}`)
      return NextResponse.json({ error: 'Schedule has no cron expression' }, { status: 400 })
    }

    const cronResult = validateCronExpression(schedule.cronExpression, schedule.timezone || 'UTC')
    if (!cronResult.isValid || !cronResult.nextRun) {
      logger.error(`[${requestId}] Invalid cron expression for schedule: ${scheduleId}`)
      return NextResponse.json({ error: 'Schedule has invalid cron expression' }, { status: 400 })
    }

    const now = new Date()
    const nextRunAt = cronResult.nextRun

    await db
      .update(workflowSchedule)
      .set({
        status: 'active',
        failedCount: 0,
        updatedAt: now,
        nextRunAt,
      })
      .where(eq(workflowSchedule.id, scheduleId))

    logger.info(`[${requestId}] Reactivated schedule: ${scheduleId}`)

    return NextResponse.json({
      message: 'Schedule activated successfully',
      nextRunAt,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating schedule`, error)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}
