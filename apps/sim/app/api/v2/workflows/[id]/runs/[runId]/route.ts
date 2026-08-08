import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2GetWorkflowRunContract,
  v2WorkflowRunStatusSchema,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
} from '@/lib/logs/execution/functional-outputs'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'
import { v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'
import { classifyExecutionError } from '@/executor/utils/errors'

const logger = createLogger('V2WorkflowRunStatusAPI')

export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/workflows/[id]/runs/[runId] — the single status URL
 * for both sync and async runs. When no log row exists yet, the async job
 * queue is consulted (deterministic job id) so a freshly-queued run reports
 * `queued` instead of 404.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; runId: string }> }) => {
    const parsed = await parseRequest(v2GetWorkflowRunContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { id: workflowId, runId } = parsed.data.params
    const { includeOutput, selectedOutputs } = parsed.data.query

    const access = await resolveV2WorkflowAccess(request, workflowId, 'read')
    if (!access.ok) return access.response

    try {
      const status = await getWorkflowExecutionStatus({
        workflowId,
        executionId: runId,
        includeOutput,
        selectedOutputs,
      })

      if (!status) {
        return v2Error('NOT_FOUND', 'Run not found')
      }

      return v2Data({
        runId: status.executionId,
        workflowId: status.workflowId,
        status: status.status,
        trigger: status.trigger ?? null,
        startedAt: status.startedAt,
        endedAt: status.endedAt,
        durationMs: status.totalDurationMs,
        paused: status.paused ? v2WorkflowRunStatusSchema.shape.paused.parse(status.paused) : null,
        cost: status.cost,
        error: status.error ? classifyExecutionError(new Error(status.error)) : null,
        output: status.finalOutput,
        blockOutputs: status.blockOutputs,
      })
    } catch (error) {
      if (error instanceof FunctionalOutputsUnavailableError) {
        return v2Error('CONFLICT', FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE)
      }
      logger.error('Failed to fetch run status', {
        workflowId,
        runId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
