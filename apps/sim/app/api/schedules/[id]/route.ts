import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getScheduleByIdContract, updateScheduleContract } from '@/lib/api/contracts/schedules'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateCronExpression } from '@/lib/workflows/schedules/utils'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

type ScheduleRow = typeof workflowSchedule.$inferSelect

async function fetchAndAuthorize(
  requestId: string,
  scheduleId: string,
  userId: string,
  action: 'read' | 'write'
): Promise<{ schedule: ScheduleRow; workspaceId: string | null } | NextResponse> {
  const [schedule] = await db
    .select()
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  if (!schedule) {
    logger.warn(`[${requestId}] Schedule not found: ${scheduleId}`)
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  if (!schedule.workflowId) {
    logger.warn(`[${requestId}] Schedule has no workflow: ${scheduleId}`)
    return NextResponse.json({ error: 'Schedule has no associated workflow' }, { status: 400 })
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

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(getScheduleByIdContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid request' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id: scheduleId } = parsed.data.params

      // fetchAndAuthorize already loads the full row (and 404s if missing), so
      // return it directly — no second query.
      const authResult = await fetchAndAuthorize(requestId, scheduleId, session.user.id, 'read')
      if (authResult instanceof NextResponse) return authResult

      return NextResponse.json({ schedule: authResult.schedule })
    } catch (error) {
      logger.error(`[${requestId}] Failed to get schedule`, { error })
      return NextResponse.json({ error: 'Failed to get schedule' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized schedule update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateScheduleContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid request body' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id: scheduleId } = parsed.data.params
      const validatedBody = parsed.data.body

      const result = await fetchAndAuthorize(requestId, scheduleId, session.user.id, 'write')
      if (result instanceof NextResponse) return result
      const { schedule, workspaceId } = result
      if (schedule.workflowId) {
        await assertWorkflowMutable(schedule.workflowId)
      }

      const { action } = validatedBody

      if (action === 'disable') {
        if (schedule.status === 'disabled') {
          return NextResponse.json({ message: 'Schedule is already disabled' })
        }

        await db
          .update(workflowSchedule)
          .set({ status: 'disabled', nextRunAt: null, lastQueuedAt: null, updatedAt: new Date() })
          .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))

        logger.info(`[${requestId}] Disabled schedule: ${scheduleId}`)

        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.SCHEDULE_UPDATED,
          resourceType: AuditResourceType.SCHEDULE,
          resourceId: scheduleId,
          resourceName: schedule.jobTitle ?? undefined,
          description: `Disabled schedule "${schedule.jobTitle ?? scheduleId}"`,
          metadata: {
            operation: 'disable',
            sourceType: schedule.sourceType,
            previousStatus: schedule.status,
          },
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
        .set({ status: 'active', failedCount: 0, infraRetryCount: 0, updatedAt: now, nextRunAt })
        .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))

      logger.info(`[${requestId}] Reactivated schedule: ${scheduleId}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.SCHEDULE_UPDATED,
        resourceType: AuditResourceType.SCHEDULE,
        resourceId: scheduleId,
        resourceName: schedule.jobTitle ?? undefined,
        description: `Reactivated schedule "${schedule.jobTitle ?? scheduleId}"`,
        metadata: {
          operation: 'reactivate',
          sourceType: schedule.sourceType,
          cronExpression: schedule.cronExpression,
          timezone: schedule.timezone,
        },
        request,
      })

      return NextResponse.json({ message: 'Schedule activated successfully', nextRunAt })
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error(`[${requestId}] Error updating schedule`, error)
      return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.SCHEDULE_DELETED,
        resourceType: AuditResourceType.SCHEDULE,
        resourceId: scheduleId,
        resourceName: schedule.jobTitle ?? undefined,
        description: `Deleted schedule "${schedule.jobTitle ?? scheduleId}"`,
        metadata: {
          sourceType: schedule.sourceType,
          cronExpression: schedule.cronExpression,
          timezone: schedule.timezone,
        },
        request,
      })

      return NextResponse.json({ message: 'Schedule deleted successfully' })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting schedule`, error)
      return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
    }
  }
)
