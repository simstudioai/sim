import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateScheduleContract } from '@/lib/api/contracts/schedules'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performDeleteJob, performUpdateJob } from '@/lib/workflows/schedules/orchestration'
import { validateCronExpression } from '@/lib/workflows/schedules/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

type ScheduleRow = {
  id: string
  workflowId: string | null
  status: string
  cronExpression: string | null
  timezone: string | null
  sourceType: string | null
  sourceWorkspaceId: string | null
  jobTitle: string | null
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
      jobTitle: workflowSchedule.jobTitle,
    })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))
    .limit(1)

  if (!schedule) {
    logger.warn(`[${requestId}] Schedule not found: ${scheduleId}`)
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  if (schedule.sourceType === 'job') {
    if (!schedule.sourceWorkspaceId) {
      return NextResponse.json({ error: 'Job has no workspace' }, { status: 400 })
    }
    const permission = await verifyWorkspaceMembership(userId, schedule.sourceWorkspaceId)
    const canWrite = permission === 'admin' || permission === 'write'
    if (!permission || (action === 'write' && !canWrite)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    return { schedule, workspaceId: schedule.sourceWorkspaceId }
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
          .set({ status: 'disabled', nextRunAt: null, updatedAt: new Date() })
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

      if (action === 'update') {
        if (schedule.sourceType !== 'job') {
          return NextResponse.json(
            { error: 'Only standalone job schedules can be edited' },
            { status: 400 }
          )
        }

        if (!workspaceId) {
          return NextResponse.json({ error: 'Job has no workspace' }, { status: 400 })
        }

        const updateResult = await performUpdateJob({
          jobId: scheduleId,
          workspaceId,
          userId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          title: validatedBody.title,
          prompt: validatedBody.prompt,
          timezone: validatedBody.timezone,
          lifecycle: validatedBody.lifecycle,
          maxRuns: validatedBody.maxRuns,
          cronExpression: validatedBody.cronExpression,
          request,
        })
        if (!updateResult.success) {
          return NextResponse.json(
            { error: updateResult.error || 'Failed to update schedule' },
            { status: updateResult.errorCode === 'validation' ? 400 : 500 }
          )
        }

        logger.info(`[${requestId}] Updated job schedule: ${scheduleId}`)

        return NextResponse.json({ message: 'Schedule updated successfully' })
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

      if (schedule.sourceType === 'job') {
        if (!workspaceId) {
          return NextResponse.json({ error: 'Job has no workspace' }, { status: 400 })
        }
        const deleteResult = await performDeleteJob({
          jobId: scheduleId,
          workspaceId,
          userId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          request,
        })
        if (!deleteResult.success) {
          return NextResponse.json(
            { error: deleteResult.error || 'Failed to delete schedule' },
            { status: deleteResult.errorCode === 'not_found' ? 404 : 500 }
          )
        }
        return NextResponse.json({ message: 'Schedule deleted successfully' })
      }

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
        description: `Deleted ${schedule.sourceType === 'job' ? 'job' : 'schedule'} "${schedule.jobTitle ?? scheduleId}"`,
        metadata: {
          sourceType: schedule.sourceType,
          cronExpression: schedule.cronExpression,
          timezone: schedule.timezone,
        },
        request,
      })

      captureServerEvent(
        session.user.id,
        'scheduled_task_deleted',
        { workspace_id: workspaceId ?? '' },
        workspaceId ? { groups: { workspace: workspaceId } } : undefined
      )

      return NextResponse.json({ message: 'Schedule deleted successfully' })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting schedule`, error)
      return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
    }
  }
)
