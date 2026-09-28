import { findCause, getErrorMessage, isProgrammingError } from '@sim/utils/errors'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { wasExecutionFinalizedByCore } from '@/lib/workflows/executor/execution-core'
import {
  classifyExecutionError,
  hasExecutionResult,
  type WorkflowExecutionErrorCode,
} from '@/executor/utils/errors'

/**
 * How a background job that ran a workflow ends when the execution threw.
 *
 * - `workflow_failure`: the workflow itself failed and core recorded it in the
 *   execution log. That is the run's outcome, so the job completes and reports
 *   it; faulting the job would page engineering for a user's workflow.
 * - `job_fault`: a failure no workflow part owns (engine, setup, a failure core
 *   could not record). The job re-throws so the queue marks the run failed and
 *   alerts on it.
 */
export type WorkflowJobFailure = 'workflow_failure' | 'job_fault'

/**
 * What a workflow job returns when the workflow failed. The job itself
 * completed, so readers of job status project `success: false` back to a
 * failed run (see `projectWorkflowJobOutcome`).
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
 * Codes that describe the workflow's own outcome even without a block to blame.
 * `CANCELLED` is absent: a cancelled run returns rather than throws, and the
 * code also matches any engine message containing "cancelled".
 */
const UNATTRIBUTED_WORKFLOW_FAILURE_CODES: ReadonlySet<WorkflowExecutionErrorCode> = new Set([
  'INVALID_INPUT',
  'USAGE_LIMIT_EXCEEDED',
])

/**
 * Whether Sim's own code, not the workflow, caused the failure: a programming
 * error anywhere in the `.cause` chain, or a link marked `isSystemError` where
 * `executeTool` flattened such an error into a result. User code never produces
 * either, since sandboxes return its errors as data.
 */
function isSystemFailure(error: unknown): boolean {
  return (
    findCause(
      error,
      (value): value is Error =>
        isProgrammingError(value) ||
        (value instanceof Error && 'isSystemError' in value && value.isSystemError === true)
    ) !== undefined
  )
}

/**
 * Decides whether an execution failure is the workflow's outcome or a fault in
 * the job running it. Only call once the run's post-execution work has settled
 * (see {@link classifyWorkflowJobFailure}). Attribution comes from
 * {@link classifyExecutionError}, the single place raw execution errors are
 * interpreted, so the job queue, the v2 API and parent workflows agree on what
 * a failure was.
 */
export function classifySettledWorkflowJobFailure(
  error: unknown,
  executionId: string
): WorkflowJobFailure {
  if (!wasExecutionFinalizedByCore(error, executionId)) return 'job_fault'
  if (isSystemFailure(error)) return 'job_fault'

  const { code, blockId } = classifyExecutionError(error)
  return blockId !== undefined || UNATTRIBUTED_WORKFLOW_FAILURE_CODES.has(code)
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
