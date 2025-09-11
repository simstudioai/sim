import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { workflow, workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduleStatusAPI')

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params
  const scheduleId = id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule status request`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [schedule] = await db
      .select({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        status: workflowSchedule.status,
        failedCount: workflowSchedule.failedCount,
        lastRanAt: workflowSchedule.lastRanAt,
        lastFailedAt: workflowSchedule.lastFailedAt,
        nextRunAt: workflowSchedule.nextRunAt,
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

    // Check authorization - either the user owns the workflow or has workspace permissions
    let isAuthorized = workflowRecord.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace permissions
    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission !== null
    }

    if (!isAuthorized) {
      logger.warn(`[${requestId}] User not authorized to view this schedule: ${scheduleId}`)
      return NextResponse.json({ error: 'Not authorized to view this schedule' }, { status: 403 })
    }

    return NextResponse.json({
      status: schedule.status,
      failedCount: schedule.failedCount,
      lastRanAt: schedule.lastRanAt,
      lastFailedAt: schedule.lastFailedAt,
      nextRunAt: schedule.nextRunAt,
      isDisabled: schedule.status === 'disabled',
    })
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving schedule status: ${scheduleId}`, error)
    return NextResponse.json({ error: 'Failed to retrieve schedule status' }, { status: 500 })
  }
}
