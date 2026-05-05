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
  'resume-execution': 'resume-execution',
  'workflow-group-cell': 'workflow-group-cell',
  'cleanup-logs': 'cleanup-logs',
  'cleanup-soft-deletes': 'cleanup-soft-deletes',
  'cleanup-tasks': 'cleanup-tasks',
  'run-data-drain': 'run-data-drain',
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

    const tags = buildTags(options)
    const triggerOptions: Parameters<typeof tasks.trigger>[2] = {}
    if (tags.length > 0) triggerOptions.tags = tags
    if (options?.concurrencyKey) triggerOptions.concurrencyKey = options.concurrencyKey
    const handle = await tasks.trigger(taskId, enrichedPayload, triggerOptions)

    logger.debug('Enqueued job via trigger.dev', { jobId: handle.id, type, taskId, tags })
    return handle.id
  }

  async getJob(jobId: string): Promise<Job | null> {
    try {
      const run = await runs.retrieve(jobId)

      const payload = run.payload as Record<string, unknown>
      const metadata: JobMetadata = {
        workflowId: payload?.workflowId as string | undefined,
        userId: payload?.userId as string | undefined,
        correlation:
          payload?.correlation && typeof payload.correlation === 'object'
            ? (payload.correlation as JobMetadata['correlation'])
            : undefined,
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

  async cancelJob(jobId: string): Promise<void> {
    try {
      await runs.cancel(jobId)
      logger.debug('Cancelled trigger.dev run', { jobId })
    } catch (error) {
      const isNotFound =
        (error instanceof Error && error.message.toLowerCase().includes('not found')) ||
        (error && typeof error === 'object' && 'status' in error && error.status === 404)
      if (isNotFound) {
        logger.debug('Cancel target not found in trigger.dev (already finished?)', { jobId })
        return
      }
      logger.error('Failed to cancel trigger.dev run', { jobId, error })
      throw error
    }
  }
}

/**
 * Derives trigger.dev tags from job type, metadata, and explicit tags.
 * Tags follow the `namespace:value` convention for consistent filtering.
 * Max 10 tags per run, each max 128 chars.
 */
function buildTags(options?: EnqueueOptions): string[] {
  const tags: string[] = []
  const meta = options?.metadata

  if (meta?.workspaceId) tags.push(`workspaceId:${meta.workspaceId}`)
  if (meta?.workflowId) tags.push(`workflowId:${meta.workflowId}`)
  if (meta?.userId) tags.push(`userId:${meta.userId}`)

  if (meta?.correlation) {
    const c = meta.correlation
    tags.push(`source:${c.source}`)
    if (c.webhookId) tags.push(`webhookId:${c.webhookId}`)
    if (c.scheduleId) tags.push(`scheduleId:${c.scheduleId}`)
    if (c.provider) tags.push(`provider:${c.provider}`)
  }

  if (options?.tags) {
    for (const tag of options.tags) {
      if (!tags.includes(tag)) tags.push(tag)
    }
  }

  return tags.slice(0, 10)
}
