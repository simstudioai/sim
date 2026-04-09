import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'

const logger = createLogger('BullMQResumeProcessor')

export async function processResume(job: Job<BullMQJobData<ResumeExecutionPayload>>) {
  const { payload } = job.data
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing resume execution job', {
    jobId: job.id,
    resumeExecutionId: payload.resumeExecutionId,
    workflowId: payload.workflowId,
  })

  return runDispatchedJob(job.data.metadata, () => executeResumeJob(payload), {
    isFinalAttempt,
  })
}
