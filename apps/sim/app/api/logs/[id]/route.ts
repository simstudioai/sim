import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { permissions, workflow, workflowExecutionLogs } from '@/db/schema'

const logger = createLogger('LogDetailsByIdAPI')

export const revalidate = 0

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized log details access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
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
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
      duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
      trigger: log.trigger,
      createdAt: log.startedAt.toISOString(),
      files: log.files || undefined,
      workflow: workflowSummary,
      executionData: {
        totalDuration: log.totalDurationMs,
        ...(log.executionData as any),
        enhanced: true,
      },
      cost: log.cost as any,
    }

    return NextResponse.json({ data: response })
  } catch (error: any) {
    logger.error(`[${requestId}] log details fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
