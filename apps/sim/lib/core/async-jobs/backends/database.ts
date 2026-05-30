import { asyncJobs, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
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
type Runner = NonNullable<EnqueueOptions['runner']>

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

const inlineAbortControllers = new Map<string, AbortController>()

/**
 * Per-cancel-key abort controllers for the `batchEnqueueAndWait` direct-call
 * path. Distinct from `inlineAbortControllers` (which keys by jobId) — this
 * map keys by the domain `cancelKey` callers pass in, since the await-blocking
 * path skips `async_jobs` entirely and has no jobId to cancel by.
 */
const inlineCancelKeyControllers = new Map<string, AbortController>()

interface Semaphore {
  limit: number
  available: number
  waiters: Array<() => void>
}
const semaphores = new Map<string, Semaphore>()

async function acquireSlot(key: string, limit: number): Promise<void> {
  let s = semaphores.get(key)
  if (!s) {
    s = { limit, available: limit, waiters: [] }
    semaphores.set(key, s)
  }
  if (s.available > 0) {
    s.available -= 1
    return
  }
  await new Promise<void>((resolve) => s.waiters.push(resolve))
}

function releaseSlot(key: string): void {
  const s = semaphores.get(key)
  if (!s) return
  const next = s.waiters.shift()
  if (next) {
    next()
    return
  }
  s.available += 1
  if (s.available === s.limit) {
    semaphores.delete(key)
  }
}

export class DatabaseJobQueue implements JobQueueBackend {
  async enqueue<TPayload>(
    type: JobType,
    payload: TPayload,
    options?: EnqueueOptions
  ): Promise<string> {
    const jobId = options?.jobId ?? `run_${generateShortId(20)}`
    const now = new Date()

    await db
      .insert(asyncJobs)
      .values({
        id: jobId,
        type,
        payload: payload as Record<string, unknown>,
        status: JOB_STATUS.PENDING,
        createdAt: now,
        runAt:
          options?.delayMs && options.delayMs > 0 ? new Date(now.getTime() + options.delayMs) : now,
        attempts: 0,
        maxAttempts: options?.maxAttempts ?? 3,
        metadata: (options?.metadata ?? {}) as Record<string, unknown>,
        updatedAt: now,
      })
      .onConflictDoNothing()

    logger.debug('Enqueued job', { jobId, type })
    if (options?.runner) {
      this.runInline(
        type,
        jobId,
        payload,
        options.runner,
        options.concurrencyKey,
        options.concurrencyLimit
      )
    }
    return jobId
  }

  async batchEnqueue<TPayload>(
    type: JobType,
    items: Array<{ payload: TPayload; options?: EnqueueOptions }>
  ): Promise<string[]> {
    if (items.length === 0) return []
    const now = new Date()
    const rows = items.map(({ payload, options }) => ({
      id: `run_${generateShortId(20)}`,
      type,
      payload: payload as Record<string, unknown>,
      status: JOB_STATUS.PENDING,
      createdAt: now,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      metadata: (options?.metadata ?? {}) as Record<string, unknown>,
      updatedAt: now,
    }))

    await db.insert(asyncJobs).values(rows)

    logger.debug('Batch-enqueued jobs', { count: rows.length, type })

    for (let i = 0; i < items.length; i++) {
      const { payload, options } = items[i]
      if (options?.runner) {
        this.runInline(
          type,
          rows[i].id,
          payload,
          options.runner,
          options.concurrencyKey,
          options.concurrencyLimit
        )
      }
    }

    return rows.map((r) => r.id)
  }

  /** Skips `async_jobs` entirely — ids are returned empty since callers can't
   *  look up rows that don't exist. Cancel goes through `cancelByKey`. */
  async batchEnqueueAndWait<TPayload>(
    type: JobType,
    items: Array<{ payload: TPayload; options?: EnqueueOptions }>
  ): Promise<string[]> {
    if (items.length === 0) return []
    const tracked: Array<{ key: string; controller: AbortController }> = []
    const runs = items.map((item) => {
      const runner = item.options?.runner
      if (!runner) return Promise.resolve()
      const controller = new AbortController()
      const cancelKey = item.options?.cancelKey
      if (cancelKey) {
        inlineCancelKeyControllers.set(cancelKey, controller)
        tracked.push({ key: cancelKey, controller })
      }
      return runner(item.payload, controller.signal).catch((err) => {
        logger.error(`[${type}] Inline run failed`, {
          cancelKey,
          error: toError(err).message,
        })
      })
    })
    try {
      await Promise.all(runs)
    } finally {
      // Compare-and-delete guards against a re-enqueue under the same key
      // racing with our cleanup.
      for (const t of tracked) {
        if (inlineCancelKeyControllers.get(t.key) === t.controller) {
          inlineCancelKeyControllers.delete(t.key)
        }
      }
    }
    return items.map(() => '')
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

  async cancelJob(jobId: string): Promise<void> {
    // Abort any in-process inline execution first so the running workflow
    // observes the signal and stops mid-flight. Then mark the row failed so
    // any future poller skips it.
    const controller = inlineAbortControllers.get(jobId)
    let aborted = false
    if (controller) {
      controller.abort('Cancelled')
      inlineAbortControllers.delete(jobId)
      aborted = true
    }

    const now = new Date()
    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.FAILED,
        completedAt: now,
        error: 'Cancelled',
        updatedAt: now,
      })
      .where(eq(asyncJobs.id, jobId))

    logger.debug('Marked job as cancelled (DB queue)', { jobId, abortedInline: aborted })
  }

  cancelByKey(cancelKey: string): boolean {
    const controller = inlineCancelKeyControllers.get(cancelKey)
    if (!controller) return false
    controller.abort('Cancelled')
    inlineCancelKeyControllers.delete(cancelKey)
    return true
  }

  /**
   * Fire-and-forget IIFE that owns the lifecycle for an inline job: registers
   * the abort controller (so `cancelJob` can interrupt mid-flight), acquires
   * a concurrency slot if `concurrencyKey` is set, drives
   * `startJob → runner → completeJob | markJobFailed`.
   */
  private runInline<TPayload>(
    type: JobType,
    jobId: string,
    payload: TPayload,
    runner: Runner,
    concurrencyKey?: string,
    concurrencyLimit?: number
  ): void {
    const abortController = new AbortController()
    inlineAbortControllers.set(jobId, abortController)
    void (async () => {
      if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
        await acquireSlot(concurrencyKey, concurrencyLimit)
      }
      try {
        await this.startJob(jobId)
        await runner(payload, abortController.signal)
        await this.completeJob(jobId, null)
      } catch (err) {
        const message = toError(err).message
        logger.error(`[${type}] Inline job ${jobId} failed`, { error: message })
        try {
          await this.markJobFailed(jobId, message)
        } catch (markErr) {
          logger.error(`[${type}] Failed to mark job ${jobId} as failed`, { markErr })
        }
      } finally {
        inlineAbortControllers.delete(jobId)
        if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
          releaseSlot(concurrencyKey)
        }
      }
    })()
  }
}
