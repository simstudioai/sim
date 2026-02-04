import { createLogger } from '@sim/logger'
import { runs, tasks } from '@trigger.dev/sdk'
import type {
  EnqueueOptions,
  Job,
  JobMetadata,
  JobQueueBackend,
  JobStatus,
  JobType,
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
      return 'pending'
    case 'EXECUTING':
    case 'RESCHEDULED':
    case 'FROZEN':
      return 'processing'
    case 'COMPLETED':
      return 'completed'
    case 'CANCELED':
    case 'FAILED':
    case 'CRASHED':
    case 'INTERRUPTED':
    case 'SYSTEM_FAILURE':
    case 'EXPIRED':
      return 'failed'
    default:
      return 'pending'
  }
}

/**
 * Adapter that wraps the trigger.dev SDK to conform to JobQueueBackend interface.
 * This allows seamless switching between trigger.dev and native backends.
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

    // Merge metadata into payload so it's available when retrieving job status.
    // This ensures access control checks work correctly since getJob() extracts
    // workflowId and userId from the payload.
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
        maxAttempts: 3, // trigger.dev doesn't expose maxAttempts, use default
        error: run.error?.message,
        output: run.output as unknown,
        metadata,
      }
    } catch (error) {
      logger.warn('Failed to get job from trigger.dev', { jobId, error })
      return null
    }
  }

  /**
   * No-op for trigger.dev - job start is handled by the task runner
   */
  async startJob(_jobId: string): Promise<void> {
    // No-op: trigger.dev handles job start internally
  }

  /**
   * No-op for trigger.dev - completion is handled by the task runner
   */
  async completeJob(_jobId: string, _output: unknown): Promise<void> {
    // No-op: trigger.dev handles completion internally
  }

  /**
   * No-op for trigger.dev - failure is handled by the task runner
   */
  async markJobFailed(_jobId: string, _error: string): Promise<void> {
    // No-op: trigger.dev handles failures internally
  }
}
