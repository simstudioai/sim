import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getScheduleByIdContract, updateScheduleContract } from '@/lib/api/contracts/schedules'
import { parseRequest } from '@/lib/api/server'
import {
  createInternalResourceConcealmentPolicy,
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { setWorkflowTriggerEnabled } from '@/lib/workflows/application/triggers'

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
    logger.warn(`Schedule not found: ${scheduleId}`, { requestId })
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  if (!schedule.workflowId) {
    logger.warn(`Schedule has no workflow: ${scheduleId}`, { requestId })
    return NextResponse.json({ error: 'Schedule has no associated workflow' }, { status: 400 })
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: schedule.workflowId,
    userId,
    action,
  })

  if (!authorization.workflow) {
    logger.warn(`Workflow not found for schedule: ${scheduleId}`, { requestId })
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  if (!authorization.allowed) {
    logger.warn(`User not authorized to modify schedule: ${scheduleId}`, { requestId })
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
      logger.error('Failed to get schedule', { error })
      return NextResponse.json({ error: 'Failed to get schedule' }, { status: 500 })
    }
  }
)

/**
 * Disables or reactivates a workflow schedule through the same use case as
 * `PATCH /api/v2/workflows/{workflowId}/triggers/{blockId}`. The id must name
 * the live deployment's row: a schedule of an older version answers 404
 * instead of being revived.
 */
export const PUT = defineInternalJsonRoute({
  contract: updateScheduleContract,
  auth: internalSessionAuth,
  operation: workflowOperations.setTriggerEnabled,
  rateLimit: internalRateLimits.none({
    reason: 'Schedule enablement retains its existing session admission policy.',
  }),
  errorPolicy: createInternalResourceConcealmentPolicy({
    notFoundMessage: 'Schedule not found',
    base: extendInternalErrorPolicy(
      {
        project: internalOrchestrationErrorPolicy.project,
        unhandled: () => internalErrorResponse(500, { error: 'Failed to update schedule' }),
      },
      (error) =>
        error instanceof InsufficientWorkspacePermissionsError
          ? internalErrorResponse(403, {
              error: 'Unauthorized: Access denied to write this workflow',
            })
          : null
    ),
  }),
  parseOptions: {
    validationErrorResponse: () =>
      NextResponse.json({ error: 'Invalid request body' }, { status: 400 }),
  },
  mapInput: ({ params, body }) => ({
    target: { kind: 'row' as const, table: 'schedule' as const, id: params.id },
    enabled: body.action === 'reactivate',
  }),
  useCase: setWorkflowTriggerEnabled,
  present: ({ trigger, changes }, { input }) => {
    const changed = changes.length > 0
    if (!input.enabled) {
      return {
        message: changed ? 'Schedule disabled successfully' : 'Schedule is already disabled',
      }
    }
    if (!changed) return { message: 'Schedule is already active' }
    return {
      message: 'Schedule activated successfully',
      ...(trigger.nextRunAt ? { nextRunAt: trigger.nextRunAt.toISOString() } : {}),
    }
  },
})

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const { id: scheduleId } = await params

      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn('Unauthorized schedule delete attempt')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const result = await fetchAndAuthorize(requestId, scheduleId, session.user.id, 'write')
      if (result instanceof NextResponse) return result
      const { schedule, workspaceId } = result

      await db.delete(workflowSchedule).where(eq(workflowSchedule.id, scheduleId))

      logger.info(`Deleted schedule: ${scheduleId}`)

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
      logger.error('Error deleting schedule', error)
      return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
    }
  }
)
