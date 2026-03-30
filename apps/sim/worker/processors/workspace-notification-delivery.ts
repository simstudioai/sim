import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import {
  executeNotificationDelivery,
  type NotificationDeliveryParams,
} from '@/background/workspace-notification-delivery'

const logger = createLogger('BullMQWorkspaceNotificationDelivery')

export async function processWorkspaceNotificationDelivery(
  job: Job<BullMQJobData<NotificationDeliveryParams>>
) {
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing workspace notification delivery job', {
    jobId: job.id,
    deliveryId: job.data.payload.deliveryId,
  })

  const result = await runDispatchedJob(
    job.data.metadata,
    () => executeNotificationDelivery(job.data.payload),
    {
      isFinalAttempt,
    }
  )

  // Retry scheduling is persisted in the notification delivery row and
  // rehydrated by the periodic sweeper, which makes retries crash-safe.
}
