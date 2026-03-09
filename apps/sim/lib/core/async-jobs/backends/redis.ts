import { createLogger } from '@sim/logger'
import type Redis from 'ioredis'
import {
  type EnqueueOptions,
  JOB_MAX_LIFETIME_SECONDS,
  JOB_RETENTION_SECONDS,
  JOB_STATUS,
  type Job,
  type JobMetadata,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
} from '@/lib/core/async-jobs/types'

const logger = createLogger('RedisJobQueue')

const KEYS = {
  job: (id: string) => `async-jobs:job:${id}`,
} as const

function serializeJob(job: Job): Record<string, string> {
  return {
    id: job.id,
    type: job.type,
    payload: JSON.stringify(job.payload),
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? '',
    completedAt: job.completedAt?.toISOString() ?? '',
    attempts: job.attempts.toString(),
    maxAttempts: job.maxAttempts.toString(),
    error: job.error ?? '',
    output: job.output !== undefined ? JSON.stringify(job.output) : '',
    metadata: JSON.stringify(job.metadata),
    updatedAt: new Date().toISOString(),
  }
}

function deserializeJob(data: Record<string, string>): Job | null {
  if (!data || !data.id) return null

  try {
    return {
      id: data.id,
      type: data.type as JobType,
      payload: JSON.parse(data.payload),
      status: data.status as JobStatus,
      createdAt: new Date(data.createdAt),
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      attempts: Number.parseInt(data.attempts, 10),
      maxAttempts: Number.parseInt(data.maxAttempts, 10),
      error: data.error || undefined,
      output: data.output ? JSON.parse(data.output) : undefined,
      metadata: JSON.parse(data.metadata) as JobMetadata,
    }
  } catch (error) {
    logger.error('Failed to deserialize job', { error, data })
    return null
  }
}

export class RedisJobQueue implements JobQueueBackend {
  private redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
  }

  async enqueue<TPayload>(
    type: JobType,
    payload: TPayload,
    options?: EnqueueOptions
  ): Promise<string> {
    const jobId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
    const now = new Date()

    const job: Job<TPayload> = {
      id: jobId,
      type,
      payload,
      status: JOB_STATUS.PENDING,
      createdAt: now,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      metadata: options?.metadata ?? {},
    }

    const key = KEYS.job(jobId)
    const serialized = serializeJob(job as Job)
    await this.redis.hset(key, serialized)
    await this.redis.expire(key, JOB_MAX_LIFETIME_SECONDS)

    logger.debug('Enqueued job', { jobId, type })
    return jobId
  }

  async getJob(jobId: string): Promise<Job | null> {
    const data = await this.redis.hgetall(KEYS.job(jobId))
    return deserializeJob(data)
  }

  async startJob(jobId: string): Promise<void> {
    const now = new Date()
    const key = KEYS.job(jobId)

    await this.redis.hset(key, {
      status: JOB_STATUS.PROCESSING,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    await this.redis.hincrby(key, 'attempts', 1)

    logger.debug('Started job', { jobId })
  }

  async completeJob(jobId: string, output: unknown): Promise<void> {
    const now = new Date()
    const key = KEYS.job(jobId)

    await this.redis.hset(key, {
      status: JOB_STATUS.COMPLETED,
      completedAt: now.toISOString(),
      output: JSON.stringify(output),
      updatedAt: now.toISOString(),
    })
    await this.redis.expire(key, JOB_RETENTION_SECONDS)

    logger.debug('Completed job', { jobId })
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    const now = new Date()
    const key = KEYS.job(jobId)

    await this.redis.hset(key, {
      status: JOB_STATUS.FAILED,
      completedAt: now.toISOString(),
      error,
      updatedAt: now.toISOString(),
    })
    await this.redis.expire(key, JOB_RETENTION_SECONDS)

    logger.debug('Marked job as failed', { jobId })
  }
}
