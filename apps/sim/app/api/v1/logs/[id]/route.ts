import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'
import { db } from '@/db'
import { permissions, workflow, workflowExecutionLogs } from '@/db/schema'

const logger = createLogger('V1LogDetailsAPI')

export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'logs-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { id } = await params

    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
        files: workflowExecutionLogs.files,
        createdAt: workflowExecutionLogs.createdAt,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        workflowColor: workflow.color,
        workflowFolderId: workflow.folderId,
        workflowUserId: workflow.userId,
        workflowWorkspaceId: workflow.workspaceId,
        workflowCreatedAt: workflow.createdAt,
        workflowUpdatedAt: workflow.updatedAt,
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
      .where(eq(workflowExecutionLogs.id, id))
      .limit(1)

    const log = rows[0]
    if (!log) {
      return NextResponse.json({ error: 'Log not found' }, { status: 404 })
    }

    const workflowSummary = {
      id: log.workflowId,
      name: log.workflowName,
      description: log.workflowDescription,
      color: log.workflowColor,
      folderId: log.workflowFolderId,
      userId: log.workflowUserId,
      workspaceId: log.workflowWorkspaceId,
      createdAt: log.workflowCreatedAt,
      updatedAt: log.workflowUpdatedAt,
    }

    const response = {
      id: log.id,
      workflowId: log.workflowId,
      executionId: log.executionId,
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt.toISOString(),
      endedAt: log.endedAt?.toISOString() || null,
      totalDurationMs: log.totalDurationMs,
      files: log.files || undefined,
      workflow: workflowSummary,
      executionData: log.executionData as any,
      cost: log.cost as any,
      createdAt: log.createdAt.toISOString(),
    }

    // Get user's workflow execution limits and usage
    const limits = await getUserLimits(userId)

    // Create response with limits information
    const apiResponse = createApiResponse({ data: response }, limits, rateLimit)

    return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
  } catch (error: any) {
    logger.error(`[${requestId}] Log details fetch error`, { error: error.message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
