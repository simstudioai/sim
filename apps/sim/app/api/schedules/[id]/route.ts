import { db } from '@sim/db'
import { workflow, workflowSchedule } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

const scheduleActionEnum = z.enum(['reactivate', 'disable'])
const scheduleStatusEnum = z.enum(['active', 'disabled'])

const scheduleUpdateSchema = z
  .object({
    action: scheduleActionEnum.optional(),
    status: scheduleStatusEnum.optional(),
  })
  .refine((data) => data.action || data.status, {
    message: 'Either action or status must be provided',
  })

/**
 * Delete a schedule
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()

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
          workspaceId: workflow.workspaceId,
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

    const workflowRecord = schedules[0].workflow

    // Check authorization - either the user owns the workflow or has write/admin workspace permissions
    let isAuthorized = workflowRecord.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace permissions
    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission === 'write' || userPermission === 'admin'
    }

    if (!isAuthorized) {
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
  const requestId = generateRequestId()

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
    const validation = scheduleUpdateSchema.safeParse(body)

    if (!validation.success) {
      const firstError = validation.error.errors[0]
      logger.warn(`[${requestId}] Validation error:`, firstError)
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { action, status: requestedStatus } = validation.data

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

    if (action === 'reactivate' || (requestedStatus && requestedStatus === 'active')) {
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

    if (action === 'disable' || (requestedStatus && requestedStatus === 'disabled')) {
      if (schedule.status === 'disabled') {
        return NextResponse.json({ message: 'Schedule is already disabled' }, { status: 200 })
      }

      const now = new Date()

      await db
        .update(workflowSchedule)
        .set({
          status: 'disabled',
          updatedAt: now,
          nextRunAt: null, // Clear next run time when disabled
        })
        .where(eq(workflowSchedule.id, scheduleId))

      logger.info(`[${requestId}] Disabled schedule: ${scheduleId}`)

      return NextResponse.json({
        message: 'Schedule disabled successfully',
      })
    }

    logger.warn(`[${requestId}] Unsupported update action for schedule: ${scheduleId}`)
    return NextResponse.json({ error: 'Unsupported update action' }, { status: 400 })
  } catch (error) {
    logger.error(`[${requestId}] Error updating schedule`, error)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}
