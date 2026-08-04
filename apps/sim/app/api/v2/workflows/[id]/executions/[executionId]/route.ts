import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowExecutionStatus,
  v2GetWorkflowExecutionContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
} from '@/lib/logs/execution/functional-outputs'
import { WORKFLOW_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/enqueue-execution'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'
import { v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'
import { classifyExecutionError } from '@/executor/utils/errors'

const logger = createLogger('V2WorkflowExecutionStatusAPI')

export const dynamic = 'force-dynamic'

/**
 * Maps the async job's phase onto the execution status enum for the window
 * before the worker writes the durable log row.
 */
function jobStatusToExecutionStatus(jobStatus: string): V2WorkflowExecutionStatus['status'] | null {
  switch (jobStatus) {
    case 'pending':
      return 'queued'
    case 'processing':
      return 'running'
    case 'failed':
      return 'failed'
    case 'completed':
      return 'completed'
    default:
      return null
  }
}

/**
 * GET /api/v2/workflows/[id]/executions/[executionId] — the single status URL
 * for both sync and async runs. When no log row exists yet, the async job
 * queue is consulted (deterministic job id) so a freshly-queued run reports
 * `queued` instead of 404.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; executionId: string }> }
  ) => {
    const parsed = await parseRequest(v2GetWorkflowExecutionContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params
    const { includeOutput, selectedOutputs } = parsed.data.query

    const access = await resolveV2WorkflowAccess(request, workflowId, 'read')
    if (!access.ok) return access.response

    try {
      const status = await getWorkflowExecutionStatus({
        workflowId,
        executionId,
        includeOutput,
        selectedOutputs,
      })

      if (status) {
        return v2Data({
          executionId: status.executionId,
          workflowId: status.workflowId,
          status: status.status,
          trigger: status.trigger ?? null,
          startedAt: status.startedAt,
          endedAt: status.endedAt,
          durationMs: status.totalDurationMs,
          paused: status.paused,
          cost: status.cost,
          error: status.error ? classifyExecutionError(new Error(status.error)) : null,
          output: status.finalOutput,
          blockOutputs: status.blockOutputs,
        })
      }

      // No log row yet — a queued/just-started async run. Backfilled from the
      // job queue via the deterministic id; authz already ran above.
      const jobQueue = await getJobQueue()
      const job = await jobQueue.getJob(`${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`)
      const jobWorkflowId =
        job?.metadata && typeof job.metadata === 'object'
          ? (job.metadata as { workflowId?: string }).workflowId
          : undefined
      const mapped = job ? jobStatusToExecutionStatus(job.status) : null
      if (!job || jobWorkflowId !== workflowId || !mapped) {
        return v2Error('NOT_FOUND', 'Execution not found')
      }

      return v2Data({
        executionId,
        workflowId,
        status: mapped,
        trigger: 'api',
        startedAt: null,
        endedAt: null,
        durationMs: null,
        paused: null,
        cost: null,
        error:
          mapped === 'failed' && job.error ? classifyExecutionError(new Error(job.error)) : null,
        output: null,
        blockOutputs: null,
      })
    } catch (error) {
      if (error instanceof FunctionalOutputsUnavailableError) {
        return v2Error('CONFLICT', FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE)
      }
      logger.error('Failed to fetch execution status', {
        workflowId,
        executionId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
