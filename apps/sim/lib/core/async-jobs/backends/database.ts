import { asyncJobs, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import {
  type EnqueueOptions,
  JOB_STATUS,
  type Job,
  type JobMetadata,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
} from '@/lib/core/async-jobs/types'

const logger = createLogger('DatabaseJobQueue')

type AsyncJobRow = typeof asyncJobs.$inferSelect

function rowToJob(row: AsyncJobRow): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    payload: row.payload,
    status: row.status as JobStatus,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    error: row.error ?? undefined,
    output: row.output as unknown,
    metadata: (row.metadata ?? {}) as JobMetadata,
  }
}

export class DatabaseJobQueue implements JobQueueBackend {
  async enqueue<TPayload>(
    type: JobType,
    payload: TPayload,
    options?: EnqueueOptions
  ): Promise<string> {
    const jobId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
    const now = new Date()

    await db.insert(asyncJobs).values({
      id: jobId,
      type,
      payload: payload as Record<string, unknown>,
      status: JOB_STATUS.PENDING,
      createdAt: now,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      metadata: (options?.metadata ?? {}) as Record<string, unknown>,
      updatedAt: now,
    })

    logger.debug('Enqueued job', { jobId, type })
    return jobId
  }

  async getJob(jobId: string): Promise<Job | null> {
    const [row] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, jobId)).limit(1)

    return row ? rowToJob(row) : null
  }

  async startJob(jobId: string): Promise<void> {
    const now = new Date()

    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.PROCESSING,
        startedAt: now,
        attempts: sql`${asyncJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(eq(asyncJobs.id, jobId))

    logger.debug('Started job', { jobId })
  }

  async completeJob(jobId: string, output: unknown): Promise<void> {
    const now = new Date()

    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.COMPLETED,
        completedAt: now,
        output: output as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(asyncJobs.id, jobId))

    logger.debug('Completed job', { jobId })
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    const now = new Date()

    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.FAILED,
        completedAt: now,
        error,
        updatedAt: now,
      })
      .where(eq(asyncJobs.id, jobId))

    logger.debug('Marked job as failed', { jobId })
  }
}
