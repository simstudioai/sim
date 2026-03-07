import { db } from '@sim/db'
import { workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { validateCronExpression } from '@/lib/workflows/schedules/utils'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

const scheduleUpdateSchema = z.object({
  action: z.enum(['reactivate', 'disable']),
})

type ScheduleRow = {
  id: string
  workflowId: string | null
  status: string
  cronExpression: string | null
  timezone: string | null
  sourceType: string | null
  sourceWorkspaceId: string | null
}

async function fetchAndAuthorize(
  requestId: string,
  scheduleId: string,
  userId: string,
  action: 'read' | 'write'
): Promise<{ schedule: ScheduleRow; workspaceId: string | null } | NextResponse> {
  const [schedule] = await db
    .select({
      id: workflowSchedule.id,
      workflowId: workflowSchedule.workflowId,
      status: workflowSchedule.status,
      cronExpression: workflowSchedule.cronExpression,
      timezone: workflowSchedule.timezone,
      sourceType: workflowSchedule.sourceType,
      sourceWorkspaceId: workflowSchedule.sourceWorkspaceId,
    })
    .from(workflowSchedule)
    .where(eq(workflowSchedule.id, scheduleId))
    .limit(1)

  if (!schedule) {
    logger.warn(`[${requestId}] Schedule not found: ${scheduleId}`)
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  if (schedule.sourceType === 'job') {
    if (!schedule.sourceWorkspaceId) {
      return NextResponse.json({ error: 'Job has no workspace' }, { status: 400 })
    }
    const allowed = await verifyWorkspaceMembership(userId, schedule.sourceWorkspaceId)
    if (!allowed) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    return { schedule, workspaceId: schedule.sourceWorkspaceId }
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: schedule.workflowId,
    userId,
    action,
  })

  if (!authorization.workflow) {
    logger.warn(`[${requestId}] Workflow not found for schedule: ${scheduleId}`)
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  if (!authorization.allowed) {
    logger.warn(`[${requestId}] User not authorized to modify schedule: ${scheduleId}`)
    return NextResponse.json(
      { error: authorization.message || 'Not authorized to modify this schedule' },
      { status: authorization.status }
    )
  }

  return { schedule, workspaceId: authorization.workflow.workspaceId ?? null }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const { id: scheduleId } = await params

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

    const result = await fetchAndAuthorize(requestId, scheduleId, session.user.id, 'write')
    if (result instanceof NextResponse) return result
    const { schedule, workspaceId } = result

    const { action } = validation.data

    if (action === 'disable') {
      if (schedule.status === 'disabled') {
        return NextResponse.json({ message: 'Schedule is already disabled' })
      }

      await db
        .update(workflowSchedule)
        .set({ status: 'disabled', nextRunAt: null, updatedAt: new Date() })
        .where(eq(workflowSchedule.id, scheduleId))

      logger.info(`[${requestId}] Disabled schedule: ${scheduleId}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.SCHEDULE_UPDATED,
        resourceType: AuditResourceType.SCHEDULE,
        resourceId: scheduleId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Disabled schedule ${scheduleId}`,
        metadata: {},
        request,
      })

      return NextResponse.json({ message: 'Schedule disabled successfully' })
    }

    // reactivate
    if (schedule.status === 'active') {
      return NextResponse.json({ message: 'Schedule is already active' })
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
      .set({ status: 'active', failedCount: 0, updatedAt: now, nextRunAt })
      .where(eq(workflowSchedule.id, scheduleId))

    logger.info(`[${requestId}] Reactivated schedule: ${scheduleId}`)

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      action: AuditAction.SCHEDULE_UPDATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: scheduleId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description: `Reactivated schedule ${scheduleId}`,
      metadata: { cronExpression: schedule.cronExpression, timezone: schedule.timezone },
      request,
    })

    return NextResponse.json({ message: 'Schedule activated successfully', nextRunAt })
  } catch (error) {
    logger.error(`[${requestId}] Error updating schedule`, error)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()

  try {
    const { id: scheduleId } = await params

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await fetchAndAuthorize(requestId, scheduleId, session.user.id, 'write')
    if (result instanceof NextResponse) return result
    const { schedule, workspaceId } = result

    await db.delete(workflowSchedule).where(eq(workflowSchedule.id, scheduleId))

    logger.info(`[${requestId}] Deleted schedule: ${scheduleId}`)

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      action: AuditAction.SCHEDULE_UPDATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: scheduleId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description: `Deleted ${schedule.sourceType === 'job' ? 'job' : 'schedule'} ${scheduleId}`,
      metadata: {},
      request,
    })

    return NextResponse.json({ message: 'Schedule deleted successfully' })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting schedule`, error)
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
  }
}
