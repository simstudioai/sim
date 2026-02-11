import { db } from '@sim/db'
import { workflowDeploymentVersion, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'

const logger = createLogger('ScheduledAPI')

/**
 * Get schedule information for a workflow
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId()
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId')
  const blockId = url.searchParams.get('blockId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule query attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 })
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
