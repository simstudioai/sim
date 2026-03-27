import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import { executeJobInline, type JobExecutionPayload } from '@/background/schedule-execution'

const logger = createLogger('BullMQMothershipJobExecution')

export async function processMothershipJobExecution(job: Job<BullMQJobData<JobExecutionPayload>>) {
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing mothership scheduled job', {
    jobId: job.id,
    scheduleId: job.data.payload.scheduleId,
  })

  await runDispatchedJob(job.data.metadata, () => executeJobInline(job.data.payload), {
    isFinalAttempt,
  })
}
