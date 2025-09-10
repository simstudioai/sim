import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'
import { db } from '@/db'
import {
  permissions,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@/db/schema'

const logger = createLogger('V1ExecutionAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const rateLimit = await checkRateLimit(request, 'logs-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { executionId } = await params

    logger.debug(`Fetching execution data for: ${executionId}`)

    const rows = await db
      .select({
        log: workflowExecutionLogs,
        workflow: workflow,
      })
      .from(workflowExecutionLogs)
      .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    const { log: workflowLog } = rows[0]

    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
      .limit(1)

    if (!snapshot) {
      return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
    }

    const response = {
      executionId,
      workflowId: workflowLog.workflowId,
      workflowState: snapshot.stateData,
      executionMetadata: {
        trigger: workflowLog.trigger,
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.endedAt?.toISOString(),
        totalDurationMs: workflowLog.totalDurationMs,
        cost: workflowLog.cost || null,
      },
    }

    logger.debug(`Successfully fetched execution data for: ${executionId}`)
    logger.debug(
      `Workflow state contains ${Object.keys((snapshot.stateData as any)?.blocks || {}).length} blocks`
    )

    // Get user's workflow execution limits and usage
    const limits = await getUserLimits(userId)

    // Create response with limits information
    const apiResponse = createApiResponse(
      {
        ...response,
      },
      limits,
      rateLimit
    )

    return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
  } catch (error) {
    logger.error('Error fetching execution data:', error)
    return NextResponse.json({ error: 'Failed to fetch execution data' }, { status: 500 })
  }
}
