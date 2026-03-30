import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import { executeScheduleJob, type ScheduleExecutionPayload } from '@/background/schedule-execution'

const logger = createLogger('BullMQScheduleProcessor')

export async function processSchedule(job: Job<BullMQJobData<ScheduleExecutionPayload>>) {
  const { payload } = job.data
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing schedule job', {
    jobId: job.id,
    name: job.name,
  })

  return runDispatchedJob(job.data.metadata, () => executeScheduleJob(payload), {
    isFinalAttempt,
  })
}
