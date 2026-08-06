import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CancelWorkflowExecutionContract } from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelWorkflowExecution,
  WorkflowExecutionNotFoundError,
} from '@/lib/execution/cancel-workflow-execution'
import { v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'

const logger = createLogger('V2CancelExecutionAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/v2/workflows/[id]/executions/[executionId]/cancel */
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const parsed = await parseRequest(v2CancelWorkflowExecutionContract, req, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params

    const access = await resolveV2WorkflowAccess(req, workflowId, 'write')
    if (!access.ok) return access.response

    try {
      logger.info('Cancel execution requested', { workflowId, executionId, userId: access.userId })

      const result = await cancelWorkflowExecution({
        executionId,
        workflowId,
        userId: access.userId,
        workspaceId: access.workflow.workspaceId ?? undefined,
      })

      return v2Data(result)
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) {
        return v2Error('NOT_FOUND', error.message)
      }
      logger.error('Failed to cancel execution', {
        workflowId,
        executionId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
