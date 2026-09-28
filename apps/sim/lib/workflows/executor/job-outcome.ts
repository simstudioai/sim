import { toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import { JOB_STATUS, type Job, type JobStatus, type JobType } from '@/lib/core/async-jobs/types'

/** Job types that complete with a `WorkflowJobFailureResult` when their workflow fails. */
const WORKFLOW_FAILURE_RESULT_JOB_TYPES: ReadonlySet<JobType> = new Set([
  'workflow-execution',
  'resume-execution',
])

/**
 * The status a workflow job stands for. The queue only knows whether the job
 * faulted; a job that completed with a `WorkflowJobFailureResult` ran a
 * workflow that failed, and callers polling the job must see that failed run.
 */
export function projectWorkflowJobOutcome(job: Pick<Job, 'type' | 'status' | 'output' | 'error'>): {
  status: JobStatus
  error?: string
} {
  const reported =
    job.error === undefined ? { status: job.status } : { status: job.status, error: job.error }
  if (job.status !== JOB_STATUS.COMPLETED || !WORKFLOW_FAILURE_RESULT_JOB_TYPES.has(job.type)) {
    return reported
  }

  const output = toRecordOrNull(job.output)
  const error = toStringOrNull(output?.error)
  if (output?.success !== false || error === null) return reported
  return { status: JOB_STATUS.FAILED, error }
}
