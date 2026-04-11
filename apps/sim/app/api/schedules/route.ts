import { db } from '@sim/db'
import { workflow, workflowDeploymentVersion, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { generateId } from '@/lib/core/utils/uuid'
import { captureServerEvent } from '@/lib/posthog/server'
import { validateCronExpression } from '@/lib/workflows/schedules/utils'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('ScheduledAPI')

/**
 * Get schedule information for a workflow, or all schedules for a workspace.
 *
 * Query params (choose one):
 *   - workflowId + optional blockId  → single schedule for one workflow
 *   - workspaceId                    → all schedules across the workspace
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId()
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId')
  const workspaceId = url.searchParams.get('workspaceId')
  const blockId = url.searchParams.get('blockId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule query attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (workspaceId) {
      return handleWorkspaceSchedules(requestId, session.user.id, workspaceId)
    }

    if (!workflowId) {
      return NextResponse.json(
        { error: 'Missing workflowId or workspaceId parameter' },
        { status: 400 }
      )
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: session.user.id,
      action: 'read',
    })

    if (!authorization.workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (!authorization.allowed) {
      return NextResponse.json(
        { error: authorization.message || 'Not authorized to view this workflow' },
        { status: authorization.status }
      )
    }

    logger.info(`[${requestId}] Getting schedule for workflow ${workflowId}`)

    const conditions = [eq(workflowSchedule.workflowId, workflowId)]
    if (blockId) {
      conditions.push(eq(workflowSchedule.blockId, blockId))
    }

    const schedule = await db
      .select({ schedule: workflowSchedule })
      .from(workflowSchedule)
      .leftJoin(
        workflowDeploymentVersion,
        and(
          eq(workflowDeploymentVersion.workflowId, workflowSchedule.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .where(
        and(
          ...conditions,
          isNull(workflowSchedule.archivedAt),
          or(
            eq(workflowSchedule.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(workflowSchedule.deploymentVersionId))
          )
        )
      )
      .limit(1)

    const headers = new Headers()
    headers.set('Cache-Control', 'no-store, max-age=0')

    if (schedule.length === 0) {
      return NextResponse.json({ schedule: null }, { headers })
    }

    const scheduleData = schedule[0].schedule
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

async function handleWorkspaceSchedules(requestId: string, userId: string, workspaceId: string) {
  const hasPermission = await verifyWorkspaceMembership(userId, workspaceId)
  if (!hasPermission) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  logger.info(`[${requestId}] Getting all schedules for workspace ${workspaceId}`)

  const [workflowRows, jobRows] = await Promise.all([
    db
      .select({
        schedule: workflowSchedule,
        workflowName: workflow.name,
        workflowColor: workflow.color,
      })
      .from(workflowSchedule)
      .innerJoin(workflow, eq(workflow.id, workflowSchedule.workflowId))
      .leftJoin(
        workflowDeploymentVersion,
        and(
          eq(workflowDeploymentVersion.workflowId, workflowSchedule.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt),
          eq(workflowSchedule.triggerType, 'schedule'),
          isNull(workflowSchedule.archivedAt),
          or(eq(workflowSchedule.sourceType, 'workflow'), isNull(workflowSchedule.sourceType)),
          or(
            eq(workflowSchedule.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(workflowSchedule.deploymentVersionId))
          )
        )
      ),
    db
      .select({ schedule: workflowSchedule })
      .from(workflowSchedule)
      .where(
        and(
          eq(workflowSchedule.sourceWorkspaceId, workspaceId),
          eq(workflowSchedule.sourceType, 'job'),
          isNull(workflowSchedule.archivedAt)
        )
      ),
  ])

  const headers = new Headers()
  headers.set('Cache-Control', 'no-store, max-age=0')

  const schedules = [
    ...workflowRows.map((r) => ({
      ...r.schedule,
      workflowName: r.workflowName,
      workflowColor: r.workflowColor,
    })),
    ...jobRows.map((r) => ({
      ...r.schedule,
      workflowName: null,
      workflowColor: null,
    })),
  ]

  return NextResponse.json({ schedules }, { headers })
}

/**
 * Create a standalone scheduled job.
 *
 * Body: { workspaceId, title, prompt, cronExpression, timezone, lifecycle?, maxRuns?, startDate? }
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      workspaceId,
      title,
      prompt,
      cronExpression,
      timezone = 'UTC',
      lifecycle = 'persistent',
      maxRuns,
      startDate,
    } = body as {
      workspaceId: string
      title: string
      prompt: string
      cronExpression: string
      timezone?: string
      lifecycle?: 'persistent' | 'until_complete'
      maxRuns?: number
      startDate?: string
    }

    if (!workspaceId || !title?.trim() || !prompt?.trim() || !cronExpression?.trim()) {
      return NextResponse.json(
        { error: 'Missing required fields: workspaceId, title, prompt, cronExpression' },
        { status: 400 }
      )
    }

    const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!hasPermission) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const validation = validateCronExpression(cronExpression, timezone)
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid cron expression' },
        { status: 400 }
      )
    }

    let nextRunAt = validation.nextRun!
    if (startDate) {
      const start = new Date(startDate)
      if (start > new Date()) {
        nextRunAt = start
      }
    }

    const now = new Date()
    const id = generateId()

    await db.insert(workflowSchedule).values({
      id,
      cronExpression,
      triggerType: 'schedule',
      sourceType: 'job',
      status: 'active',
      timezone,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
      failedCount: 0,
      jobTitle: title.trim(),
      prompt: prompt.trim(),
      lifecycle,
      maxRuns: maxRuns ?? null,
      runCount: 0,
      sourceWorkspaceId: workspaceId,
      sourceUserId: session.user.id,
    })

    logger.info(`[${requestId}] Created job schedule ${id}`, {
      title,
      cronExpression,
      timezone,
      lifecycle,
    })

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.SCHEDULE_CREATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: id,
      resourceName: title.trim(),
      description: `Created job schedule "${title.trim()}"`,
      metadata: {
        cronExpression,
        timezone,
        lifecycle,
        maxRuns: maxRuns ?? null,
      },
      request: req,
    })

    captureServerEvent(
      session.user.id,
      'scheduled_task_created',
      { workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )

    return NextResponse.json(
      { schedule: { id, status: 'active', cronExpression, nextRunAt } },
      { status: 201 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error creating schedule`, error)
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 })
  }
}
