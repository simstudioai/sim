import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { validateCronExpression } from '@/lib/workflows/schedules/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('ScheduleAPI')

export const dynamic = 'force-dynamic'

const scheduleUpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reactivate') }),
  z.object({ action: z.literal('disable') }),
  z.object({
    action: z.literal('update'),
    title: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    lifecycle: z.enum(['persistent', 'until_complete']).optional(),
    maxRuns: z.number().nullable().optional(),
  }),
])

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
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

        const updates = validation.data
        const setFields: Record<string, unknown> = { updatedAt: new Date() }

        if (updates.title !== undefined) setFields.jobTitle = updates.title.trim()
        if (updates.prompt !== undefined) setFields.prompt = updates.prompt.trim()
        if (updates.timezone !== undefined) setFields.timezone = updates.timezone
        if (updates.lifecycle !== undefined) {
          setFields.lifecycle = updates.lifecycle
          if (updates.lifecycle === 'persistent') {
            setFields.maxRuns = null
          }
        }
        if (updates.maxRuns !== undefined) setFields.maxRuns = updates.maxRuns

        if (updates.cronExpression !== undefined) {
          const tz = updates.timezone ?? schedule.timezone ?? 'UTC'
          const cronResult = validateCronExpression(updates.cronExpression, tz)
          if (!cronResult.isValid) {
            return NextResponse.json(
              { error: cronResult.error || 'Invalid cron expression' },
              { status: 400 }
            )
          }
          setFields.cronExpression = updates.cronExpression
          if (schedule.status === 'active' && cronResult.nextRun) {
            setFields.nextRunAt = cronResult.nextRun
          }
        }

        await db
          .update(workflowSchedule)
          .set(setFields)
          .where(and(eq(workflowSchedule.id, scheduleId), isNull(workflowSchedule.archivedAt)))

        logger.info(`[${requestId}] Updated job schedule: ${scheduleId}`)

        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.SCHEDULE_UPDATED,
          resourceType: AuditResourceType.SCHEDULE,
          resourceId: scheduleId,
          resourceName: schedule.jobTitle ?? undefined,
          description: `Updated job schedule "${schedule.jobTitle ?? scheduleId}"`,
          metadata: {
            operation: 'update',
            updatedFields: Object.keys(setFields).filter((k) => k !== 'updatedAt'),
          },
          request,
        })

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
