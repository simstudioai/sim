import { createLogger } from '@sim/logger'
import type { Job as BullMQJob } from 'bullmq'
import {
  type EnqueueOptions,
  JOB_STATUS,
  type Job,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
} from '@/lib/core/async-jobs/types'
import { type BullMQJobData, createBullMQJobData, getBullMQQueue } from '@/lib/core/bullmq'

const logger = createLogger('BullMQJobQueue')

function mapBullMQStatus(status: string): JobStatus {
  switch (status) {
    case 'active':
      return JOB_STATUS.PROCESSING
    case 'completed':
      return JOB_STATUS.COMPLETED
    case 'failed':
      return JOB_STATUS.FAILED
    default:
      return JOB_STATUS.PENDING
  }
}

async function toJob(
  queueType: JobType,
  bullJob: BullMQJob<BullMQJobData<unknown>> | null
): Promise<Job | null> {
  if (!bullJob) {
    return null
  }

  const status = mapBullMQStatus(await bullJob.getState())

  return {
    id: bullJob.id ?? '',
    type: queueType,
    payload: bullJob.data.payload,
    status,
    createdAt: new Date(bullJob.timestamp),
    startedAt: bullJob.processedOn ? new Date(bullJob.processedOn) : undefined,
    completedAt: bullJob.finishedOn ? new Date(bullJob.finishedOn) : undefined,
    attempts: bullJob.attemptsMade,
    maxAttempts: bullJob.opts.attempts ?? 1,
    error: bullJob.failedReason || undefined,
    output: bullJob.returnvalue,
    metadata: bullJob.data.metadata ?? {},
  }
}

export class BullMQJobQueue implements JobQueueBackend {
  async enqueue<TPayload>(
    type: JobType,
    payload: TPayload,
    options?: EnqueueOptions
  ): Promise<string> {
    const queue = getBullMQQueue(type)

    const job = await queue.add(
      options?.name ?? type,
      createBullMQJobData(payload, options?.metadata),
      {
        jobId: options?.jobId,
        attempts: options?.maxAttempts,
        priority: options?.priority,
        delay: options?.delayMs,
      }
    )

    logger.debug('Enqueued job via BullMQ', {
      jobId: job.id,
      type,
      name: options?.name ?? type,
    })

    return String(job.id)
  }

  async getJob(jobId: string): Promise<Job | null> {
    const workflowJob = await getBullMQQueue('workflow-execution').getJob(jobId)
    if (workflowJob) {
      return toJob('workflow-execution', workflowJob)
    }

    const webhookJob = await getBullMQQueue('webhook-execution').getJob(jobId)
    if (webhookJob) {
      return toJob('webhook-execution', webhookJob)
    }

    const scheduleJob = await getBullMQQueue('schedule-execution').getJob(jobId)
    if (scheduleJob) {
      return toJob('schedule-execution', scheduleJob)
    }

    return null
  }

  async startJob(_jobId: string): Promise<void> {}

  async completeJob(_jobId: string, _output: unknown): Promise<void> {}

  async markJobFailed(_jobId: string, _error: string): Promise<void> {}
}
