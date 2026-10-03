import type { LogTraceSpan, WorkflowLogDetail } from '@/lib/api/contracts/logs'
import { isTriggerBlockType } from '@/executor/constants'

export type RetryTargetResolution =
  | { success: true; startBlockId: string }
  | { success: false; error: string }

const MISSING_HISTORY_ERROR =
  'This run does not include enough execution history to retry from the failed block.'
const MULTIPLE_FAILURES_ERROR =
  'This run has multiple terminating failures and cannot be retried from a single block.'
const UNSUPPORTED_NESTED_FAILURE_ERROR =
  'Retrying failures inside loops or parallel groups is not supported yet.'
const MISSING_BLOCK_ERROR = 'The failed block could not be identified safely for this run.'
const MISSING_TRIGGER_INPUT_ERROR =
  'The original input for this failed trigger is unavailable, so it cannot be retried safely.'

function executionSpans(traceSpans: LogTraceSpan[]): LogTraceSpan[] {
  if (traceSpans.length !== 1) return traceSpans

  const [rootSpan] = traceSpans
  if (rootSpan.type === 'workflow' && !rootSpan.blockId) {
    return rootSpan.children ?? []
  }

  return traceSpans
}

function isTruncatedExecutionValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_truncated' in value &&
    value._truncated === true
  )
}

/** Resolves the one top-level block that safely represents a failed run's terminating error. */
export function resolveRetryTarget(
  executionData: WorkflowLogDetail['executionData']
): RetryTargetResolution {
  const traceSpans = executionData.traceSpans
  if (!traceSpans?.length) {
    return { success: false, error: MISSING_HISTORY_ERROR }
  }

  const failures = executionSpans(traceSpans).filter(
    (span) => span.status === 'error' && span.errorHandled !== true
  )

  if (failures.length === 0) {
    return { success: false, error: MISSING_HISTORY_ERROR }
  }
  if (failures.length > 1) {
    return { success: false, error: MULTIPLE_FAILURES_ERROR }
  }

  const [failedSpan] = failures
  if (failedSpan.type === 'loop' || failedSpan.type === 'parallel') {
    return { success: false, error: UNSUPPORTED_NESTED_FAILURE_ERROR }
  }
  if (!failedSpan.blockId) {
    return { success: false, error: MISSING_BLOCK_ERROR }
  }

  if (
    isTriggerBlockType(failedSpan.type) &&
    (executionData.workflowInput === undefined ||
      isTruncatedExecutionValue(executionData.workflowInput))
  ) {
    return { success: false, error: MISSING_TRIGGER_INPUT_ERROR }
  }

  return { success: true, startBlockId: failedSpan.blockId }
}
