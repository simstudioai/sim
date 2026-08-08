import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CancelWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelWorkflowExecution,
  WorkflowExecutionNotFoundError,
} from '@/lib/execution/cancel-workflow-execution'
import { v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'

const logger = createLogger('V2CancelRunAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; runId: string }> }) => {
    const parsed = await parseRequest(v2CancelWorkflowRunContract, req, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { id: workflowId, runId } = parsed.data.params

    const access = await resolveV2WorkflowAccess(req, workflowId, 'write')
    if (!access.ok) return access.response

    try {
      logger.info('Cancel run requested', { workflowId, runId, userId: access.userId })

      const result = await cancelWorkflowExecution({
        executionId: runId,
        workflowId,
        userId: access.userId,
        workspaceId: access.workflow.workspaceId ?? undefined,
      })

      return v2Data({
        success: result.success,
        runId: result.executionId,
        redisAvailable: result.redisAvailable,
        durablyRecorded: result.durablyRecorded,
        locallyAborted: result.locallyAborted,
        pausedCancelled: result.pausedCancelled,
        reason: result.reason,
      })
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) {
        return v2Error('NOT_FOUND', error.message)
      }
      logger.error('Failed to cancel run', {
        workflowId,
        runId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
