import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

/**
 * Delete a schedule
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Deleting schedule with ID: ${id}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the schedule and check ownership
    const schedules = await db
      .select({
        schedule: workflowSchedule,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
        },
      })
      .from(workflowSchedule)
      .innerJoin(workflow, eq(workflowSchedule.workflowId, workflow.id))
      .where(eq(workflowSchedule.id, id))
      .limit(1)

    if (schedules.length === 0) {
      logger.warn(`[${requestId}] Schedule not found: ${id}`)
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    if (schedules[0].workflow.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized schedule deletion attempt for schedule: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Delete the schedule
    await db.delete(workflowSchedule).where(eq(workflowSchedule.id, id))

    logger.info(`[${requestId}] Successfully deleted schedule: ${id}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting schedule`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Update a schedule - can be used to reactivate a disabled schedule
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    const scheduleId = id
    logger.debug(`[${requestId}] Updating schedule with ID: ${scheduleId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    const [schedule] = await db
      .select({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        status: workflowSchedule.status,
      })
      .from(workflowSchedule)
      .where(eq(workflowSchedule.id, scheduleId))
      .limit(1)

    if (!schedule) {
      logger.warn(`[${requestId}] Schedule not found: ${scheduleId}`)
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const [workflowRecord] = await db
      .select({ userId: workflow.userId })
      .from(workflow)
      .where(eq(workflow.id, schedule.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow not found for schedule: ${scheduleId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (workflowRecord.userId !== session.user.id) {
      logger.warn(`[${requestId}] User not authorized to modify this schedule: ${scheduleId}`)
      return NextResponse.json({ error: 'Not authorized to modify this schedule' }, { status: 403 })
    }

    if (action === 'reactivate' || (body.status && body.status === 'active')) {
      if (schedule.status === 'active') {
        return NextResponse.json({ message: 'Schedule is already active' }, { status: 200 })
      }

      const now = new Date()
      const nextRunAt = new Date(now.getTime() + 60 * 1000) // Schedule to run in 1 minute

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
    }

    logger.warn(`[${requestId}] Unsupported update action for schedule: ${scheduleId}`)
    return NextResponse.json({ error: 'Unsupported update action' }, { status: 400 })
  } catch (error) {
    logger.error(`[${requestId}] Error updating schedule`, error)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}
