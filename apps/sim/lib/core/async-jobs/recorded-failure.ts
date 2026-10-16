import { isRecordLike } from '@sim/utils/object'
import { truncateAtCodePoint } from '@sim/utils/string'
import type { JobType } from '@/lib/core/async-jobs/types'

/**
 * Job types whose runner reports a failure the run already recorded in its
 * execution log by completing with a {@link RecordedJobFailureResult} instead
 * of throwing, so the queue does not fault (and alert on) a user or workflow
 * error.
 */
const RECORDED_FAILURE_JOB_TYPES: ReadonlySet<string> = new Set<JobType>(['workflow-execution'])

/**
 * Keeps the result far below Trigger.dev's output offload threshold: an
 * offloaded output is not returned inline by `runs.retrieve`, so the job would
 * read as completed instead of failed.
 */
const RECORDED_FAILURE_ERROR_MAX_LENGTH = 64_000

interface RecordedJobFailureResult {
  success: false
  workflowId: string
  executionId: string
  error: string
  executedAt: string
}

export function buildRecordedJobFailureResult(params: {
  workflowId: string
  executionId: string
  error: string
}): RecordedJobFailureResult {
  return {
    success: false,
    workflowId: params.workflowId,
    executionId: params.executionId,
    error: truncateAtCodePoint(params.error, RECORDED_FAILURE_ERROR_MAX_LENGTH),
    executedAt: new Date().toISOString(),
  }
}

/**
 * The error of a completed job whose output is a recorded failure, or
 * `undefined` for any other job. Queue read paths project such a job as failed
 * with this error and no output, so pollers see exactly what they saw when the
 * runner threw.
 */
export function getRecordedJobFailureError(type: string, output: unknown): string | undefined {
  if (!RECORDED_FAILURE_JOB_TYPES.has(type) || !isRecordLike(output)) return undefined
  return output.success === false && typeof output.error === 'string' ? output.error : undefined
}
