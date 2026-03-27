import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import { executeWebhookJob, type WebhookExecutionPayload } from '@/background/webhook-execution'

const logger = createLogger('BullMQWebhookProcessor')

export async function processWebhook(job: Job<BullMQJobData<WebhookExecutionPayload>>) {
  const { payload } = job.data
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing webhook job', {
    jobId: job.id,
    name: job.name,
  })

  return runDispatchedJob(job.data.metadata, () => executeWebhookJob(payload), {
    isFinalAttempt,
  })
}
