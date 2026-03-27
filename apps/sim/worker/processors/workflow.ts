import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import {
  DIRECT_WORKFLOW_JOB_NAME,
  executeQueuedWorkflowJob,
  type QueuedWorkflowExecutionPayload,
} from '@/lib/workflows/executor/queued-workflow-execution'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'

const logger = createLogger('BullMQWorkflowProcessor')

type WorkflowQueueJobData =
  | BullMQJobData<QueuedWorkflowExecutionPayload>
  | BullMQJobData<WorkflowExecutionPayload>

function isDirectWorkflowJob(
  job: Job<WorkflowQueueJobData>
): job is Job<BullMQJobData<QueuedWorkflowExecutionPayload>> {
  return job.name === DIRECT_WORKFLOW_JOB_NAME
}

function isBackgroundWorkflowJob(
  job: Job<WorkflowQueueJobData>
): job is Job<BullMQJobData<WorkflowExecutionPayload>> {
  return job.name !== DIRECT_WORKFLOW_JOB_NAME
}

export async function processWorkflow(job: Job<WorkflowQueueJobData>) {
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing workflow job', {
    jobId: job.id,
    name: job.name,
  })

  if (isDirectWorkflowJob(job)) {
    return runDispatchedJob(job.data.metadata, () => executeQueuedWorkflowJob(job.data.payload), {
      isFinalAttempt,
    })
  }

  if (isBackgroundWorkflowJob(job)) {
    return runDispatchedJob(job.data.metadata, () => executeWorkflowJob(job.data.payload), {
      isFinalAttempt,
    })
  }

  throw new Error(`Unsupported workflow job type: ${job.name}`)
}
