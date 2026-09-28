import { getErrorMessage } from '@sim/utils/errors'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { wasExecutionFinalizedByCore } from '@/lib/workflows/executor/execution-core'
import { hasExecutionResult, isWorkflowUserFailure } from '@/executor/utils/errors'

/**
 * How a background job that ran a workflow ends when the execution threw.
 *
 * - `workflow_failure`: the workflow itself failed (see `markWorkflowUserFailure`)
 *   and core recorded it in the execution log. That is the run's outcome, so the
 *   job completes and reports it instead of paging engineering.
 * - `job_fault`: everything else, including any failure not positively known to
 *   be the workflow's. The job re-throws so the queue fails the run and alerts.
 */
export type WorkflowJobFailure = 'workflow_failure' | 'job_fault'

/**
 * What a workflow job returns when its workflow failed. The job itself
 * completed, so readers of job status project it back to a failed run (see
 * `projectWorkflowJobOutcome`).
 */
export interface WorkflowJobFailureResult {
  success: false
  workflowId: string
  executionId: string
  output: unknown
  error: string
  executedAt: string
}

/** Builds the {@link WorkflowJobFailureResult} for a workflow that failed. */
export function buildWorkflowJobFailureResult(params: {
  error: unknown
  workflowId: string
  executionId: string
}): WorkflowJobFailureResult {
  return {
    success: false,
    workflowId: params.workflowId,
    executionId: params.executionId,
    output: hasExecutionResult(params.error) ? params.error.executionResult.output : {},
    error: getErrorMessage(params.error, 'Execution failed'),
    executedAt: new Date().toISOString(),
  }
}

/**
 * Decides whether an execution failure is the workflow's outcome or a fault in
 * the job running it. Only call once the run's post-execution work has settled
 * (see {@link classifyWorkflowJobFailure}).
 */
export function classifySettledWorkflowJobFailure(
  error: unknown,
  executionId: string
): WorkflowJobFailure {
  return wasExecutionFinalizedByCore(error, executionId) && isWorkflowUserFailure(error)
    ? 'workflow_failure'
    : 'job_fault'
}

/**
 * {@link classifySettledWorkflowJobFailure} for a caller holding the run's
 * logging session. Core throws before its post-execution work records the
 * failure, so the finalized signal is only reliable once that work settles.
 */
export async function classifyWorkflowJobFailure(params: {
  error: unknown
  executionId: string
  loggingSession: Pick<LoggingSession, 'waitForPostExecution'>
}): Promise<WorkflowJobFailure> {
  await params.loggingSession.waitForPostExecution()
  return classifySettledWorkflowJobFailure(params.error, params.executionId)
}
