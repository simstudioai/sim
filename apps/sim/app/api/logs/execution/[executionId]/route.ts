import { db } from '@sim/db'
import {
  permissions,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('LogsByExecutionIdAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const requestId = generateRequestId()

  try {
    const { executionId } = await params

    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized execution data access attempt for: ${executionId}`)
      return NextResponse.json(
        { error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const authenticatedUserId = authResult.userId

    logger.debug(
      `[${requestId}] Fetching execution data for: ${executionId} (auth: ${authResult.authType})`
    )

    const [workflowLog] = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        cost: workflowExecutionLogs.cost,
      })
      .from(workflowExecutionLogs)
      .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflow.workspaceId),
          eq(permissions.userId, authenticatedUserId)
        )
      )
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!workflowLog) {
      logger.warn(`[${requestId}] Execution not found or access denied: ${executionId}`)
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
      .limit(1)

    if (!snapshot) {
      logger.warn(`[${requestId}] Workflow state snapshot not found for execution: ${executionId}`)
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

    logger.debug(`[${requestId}] Successfully fetched execution data for: ${executionId}`)
    logger.debug(
      `[${requestId}] Workflow state contains ${Object.keys((snapshot.stateData as any)?.blocks || {}).length} blocks`
    )

    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error fetching execution data:`, error)
    return NextResponse.json({ error: 'Failed to fetch execution data' }, { status: 500 })
  }
}
