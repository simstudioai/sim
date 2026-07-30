import { db } from '@sim/db'
import { workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { type V2Execution, v2GetExecutionContract } from '@/lib/api/contracts/v2/logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2ExecutionAPI')

export const revalidate = 0

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ executionId: string }> }) => {
    try {
      const rateLimit = await checkRateLimit(request, 'logs-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2GetExecutionContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { executionId } = parsed.data.params

      const rows = await db
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .limit(1)

      if (rows.length === 0) return v2Error('NOT_FOUND', 'Workflow execution not found')

      const workflowLog = rows[0]

      // Convert an authorization failure into 404 so existence is not leaked.
      const access = await resolveWorkspaceAccess(rateLimit, userId, workflowLog.workspaceId)
      if (access) return v2Error('NOT_FOUND', 'Workflow execution not found')

      const [snapshot] = await db
        .select()
        .from(workflowExecutionSnapshots)
        .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
        .limit(1)

      if (!snapshot) return v2Error('NOT_FOUND', 'Workflow state snapshot not found')

      const execution: V2Execution = {
        executionId,
        workflowId: workflowLog.workflowId,
        workflowState: snapshot.stateData,
        executionMetadata: {
          trigger: workflowLog.trigger,
          startedAt: workflowLog.startedAt.toISOString(),
          endedAt: workflowLog.endedAt ? workflowLog.endedAt.toISOString() : null,
          totalDurationMs: workflowLog.totalDurationMs,
          cost: workflowLog.costTotal != null ? { total: Number(workflowLog.costTotal) } : null,
        },
      }

      return v2Data(execution, { rateLimit })
    } catch (error) {
      logger.error('Error fetching execution data', {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
