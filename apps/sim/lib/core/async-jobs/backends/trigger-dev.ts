import { createLogger } from '@sim/logger'
import { runs, tasks } from '@trigger.dev/sdk'
import {
  type EnqueueOptions,
  JOB_STATUS,
  type Job,
  type JobMetadata,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
} from '@/lib/core/async-jobs/types'

const logger = createLogger('TriggerDevJobQueue')

/**
 * Maps trigger.dev task IDs to our JobType
 */
const JOB_TYPE_TO_TASK_ID: Record<JobType, string> = {
  'workflow-execution': 'workflow-execution',
  'schedule-execution': 'schedule-execution',
  'webhook-execution': 'webhook-execution',
}

/**
 * Maps trigger.dev run status to our JobStatus
 */
function mapTriggerDevStatus(status: string): JobStatus {
  switch (status) {
    case 'QUEUED':
    case 'WAITING_FOR_DEPLOY':
      return JOB_STATUS.PENDING
    case 'EXECUTING':
    case 'RESCHEDULED':
    case 'FROZEN':
      return JOB_STATUS.PROCESSING
    case 'COMPLETED':
      return JOB_STATUS.COMPLETED
    case 'CANCELED':
    case 'FAILED':
    case 'CRASHED':
    case 'INTERRUPTED':
    case 'SYSTEM_FAILURE':
    case 'EXPIRED':
      return JOB_STATUS.FAILED
    default:
      return JOB_STATUS.PENDING
  }
}

/**
 * Adapter that wraps the trigger.dev SDK to conform to JobQueueBackend interface.
 */
export class TriggerDevJobQueue implements JobQueueBackend {
  async enqueue<TPayload>(
    type: JobType,
    payload: TPayload,
    options?: EnqueueOptions
  ): Promise<string> {
    const taskId = JOB_TYPE_TO_TASK_ID[type]
    if (!taskId) {
      throw new Error(`Unknown job type: ${type}`)
    }

    const enrichedPayload =
      options?.metadata && typeof payload === 'object' && payload !== null
        ? { ...payload, ...options.metadata }
        : payload

    const handle = await tasks.trigger(taskId, enrichedPayload)

    logger.debug('Enqueued job via trigger.dev', { jobId: handle.id, type, taskId })
    return handle.id
  }

  async getJob(jobId: string): Promise<Job | null> {
    try {
      const run = await runs.retrieve(jobId)

      const payload = run.payload as Record<string, unknown>
      const metadata: JobMetadata = {
        workflowId: payload?.workflowId as string | undefined,
        userId: payload?.userId as string | undefined,
      }

      return {
        id: jobId,
        type: run.taskIdentifier as JobType,
        payload: run.payload,
        status: mapTriggerDevStatus(run.status),
        createdAt: run.createdAt ? new Date(run.createdAt) : new Date(),
        startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
        completedAt: run.finishedAt ? new Date(run.finishedAt) : undefined,
        attempts: run.attemptCount ?? 1,
        maxAttempts: 3,
        error: run.error?.message,
        output: run.output as unknown,
        metadata,
      }
    } catch (error) {
      const isNotFound =
        (error instanceof Error && error.message.toLowerCase().includes('not found')) ||
        (error && typeof error === 'object' && 'status' in error && error.status === 404)

      if (isNotFound) {
        logger.debug('Job not found in trigger.dev', { jobId })
        return null
      }

      logger.error('Failed to get job from trigger.dev', { jobId, error })
      throw error
    }
  }

  async startJob(_jobId: string): Promise<void> {}

  async completeJob(_jobId: string, _output: unknown): Promise<void> {}

  async markJobFailed(_jobId: string, _error: string): Promise<void> {}
}
