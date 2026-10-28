import { isRecordLike } from '@sim/utils/object'
import type { JobType } from '@/lib/core/async-jobs/types'

/**
 * The job type whose runner reports a failure the run already recorded in its
 * execution log by completing with a {@link RecordedJobFailureResult} instead
 * of throwing, so the queue does not fault (and alert on) a user or workflow
 * error.
 */
const RECORDED_FAILURE_JOB_TYPE: JobType = 'workflow-execution'

/**
 * Bounds the error in UTF-8 bytes so the result stays inline under Trigger.dev's
 * 128 KiB output offload threshold even if JSON escaping inflates every byte
 * sixfold (`\u0000`). `runs.retrieve` resolves an offloaded output through
 * its presigned URL, but if that fetch fails the output reads as missing and
 * the job would read as completed instead of failed.
 */
const RECORDED_FAILURE_ERROR_MAX_BYTES = 16 * 1024

/** Cuts at a code point boundary so the kept prefix is valid UTF-8. */
function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return `${bytes.subarray(0, end).toString('utf8')}...`
}

interface RecordedJobFailureResult {
  success: false
  workflowId: string
  executionId: string
  error: string
  executedAt: string
}

/** The output a runner completes with when its failure is already in the execution log. */
export function buildRecordedJobFailureResult(params: {
  workflowId: string
  executionId: string
  error: string
}): RecordedJobFailureResult {
  return {
    success: false,
    workflowId: params.workflowId,
    executionId: params.executionId,
    error: truncateUtf8(params.error, RECORDED_FAILURE_ERROR_MAX_BYTES),
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
  if (type !== RECORDED_FAILURE_JOB_TYPE || !isRecordLike(output)) return undefined
  return output.success === false && typeof output.error === 'string' ? output.error : undefined
}
