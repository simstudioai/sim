import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { type V2LogDetail, v2GetLogContract } from '@/lib/api/contracts/v2/logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2LogDetailAPI')

export const revalidate = 0

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'logs-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2GetLogContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const rows = await db
        .select({
          id: workflowExecutionLogs.id,
          workflowId: workflowExecutionLogs.workflowId,
          workspaceId: workflowExecutionLogs.workspaceId,
          executionId: workflowExecutionLogs.executionId,
          level: workflowExecutionLogs.level,
          trigger: workflowExecutionLogs.trigger,
          startedAt: workflowExecutionLogs.startedAt,
          endedAt: workflowExecutionLogs.endedAt,
          totalDurationMs: workflowExecutionLogs.totalDurationMs,
          executionData: workflowExecutionLogs.executionData,
          costTotal: workflowExecutionLogs.costTotal,
          files: workflowExecutionLogs.files,
          createdAt: workflowExecutionLogs.createdAt,
          workflowName: workflow.name,
          workflowDescription: workflow.description,
          workflowFolderId: workflow.folderId,
          workflowUserId: workflow.userId,
          workflowWorkspaceId: workflow.workspaceId,
          workflowCreatedAt: workflow.createdAt,
          workflowUpdatedAt: workflow.updatedAt,
        })
        .from(workflowExecutionLogs)
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .where(eq(workflowExecutionLogs.id, id))
        .limit(1)

      const log = rows[0]
      if (!log) return v2Error('NOT_FOUND', 'Log not found')

      // Convert an authorization failure into 404 so existence is not leaked.
      const access = await resolveWorkspaceAccess(rateLimit, userId, log.workspaceId)
      if (access) return v2Error('NOT_FOUND', 'Log not found')

      const executionData = await materializeExecutionData(
        log.executionData as Record<string, unknown> | null,
        { workspaceId: log.workspaceId, workflowId: log.workflowId, executionId: log.executionId }
      )

      const detail: V2LogDetail = {
        id: log.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
        totalDurationMs: log.totalDurationMs,
        files: (log.files as unknown[] | null) ?? null,
        workflow: {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          folderId: log.workflowFolderId,
          userId: log.workflowUserId,
          workspaceId: log.workflowWorkspaceId,
          createdAt: log.workflowCreatedAt ? log.workflowCreatedAt.toISOString() : null,
          updatedAt: log.workflowUpdatedAt ? log.workflowUpdatedAt.toISOString() : null,
          deleted: !log.workflowName,
        },
        executionData,
        cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
        createdAt: log.createdAt.toISOString(),
      }

      return v2Data(detail, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Log detail fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
