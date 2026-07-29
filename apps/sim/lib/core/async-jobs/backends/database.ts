import { asyncJobs, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, lte, or, sql } from 'drizzle-orm'
import {
  AsyncJobEnqueueError,
  type EnqueueOptions,
  JOB_STATUS,
  type Job,
  type JobMetadata,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
} from '@/lib/core/async-jobs/types'

const logger = createLogger('DatabaseJobQueue')
const INLINE_CLAIM_ATTEMPTS = 3
const INLINE_CLAIM_LEASE_MS = 2 * 60 * 1000
const INLINE_CLAIM_HEARTBEAT_MS = 30 * 1000

type AsyncJobRow = typeof asyncJobs.$inferSelect
type Runner = NonNullable<EnqueueOptions['runner']>
type InlineClaimResult<TPayload> =
  | { state: 'owned'; payload: TPayload }
  | { state: 'active' }
  | { state: 'settled' }

function getInlineClaimToken(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined
  const internal = (metadata as Record<string, unknown>).__sim
  if (!internal || typeof internal !== 'object') return undefined
  const claim = (internal as Record<string, unknown>).inlineClaim
  if (!claim || typeof claim !== 'object') return undefined
  const token = (claim as Record<string, unknown>).token
  return typeof token === 'string' ? token : undefined
}

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

    try {
      await db
        .insert(asyncJobs)
        .values({
          id: jobId,
          type,
          payload: payload as Record<string, unknown>,
          status: JOB_STATUS.PENDING,
          createdAt: now,
          runAt:
            options?.delayMs && options.delayMs > 0
              ? new Date(now.getTime() + options.delayMs)
              : now,
          attempts: 0,
          maxAttempts: options?.maxAttempts ?? 3,
          metadata: (options?.metadata ?? {}) as Record<string, unknown>,
          updatedAt: now,
        })
        .onConflictDoNothing()
    } catch (error) {
      let existingJob: Job | null
      try {
        existingJob = await this.getJob(jobId)
      } catch (verificationError) {
        throw new AsyncJobEnqueueError(
          `Unable to verify database enqueue after failure: ${toError(verificationError).message}`,
          {
            acceptance: 'unknown',
            retryable: true,
            cause: error,
          }
        )
      }

      if (!existingJob) {
        throw new AsyncJobEnqueueError(toError(error).message, {
          acceptance: 'rejected',
          retryable: true,
          cause: error,
        })
      }

      logger.warn('Recovered accepted database enqueue after insert failure', {
        jobId,
        type,
      })
    }

    logger.debug('Enqueued job', { jobId, type })
    if (options?.runner) {
      await this.startInline(
        type,
        jobId,
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

    await Promise.all(
      items.map(({ options }, index) => {
        if (!options?.runner) return Promise.resolve()
        return this.startInline(
          type,
          rows[index].id,
          options.runner,
          options.concurrencyKey,
          options.concurrencyLimit
        )
      })
    )

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
      // Same shared-key semaphore as `runInline`: without it, overlapping
      // batches on one concurrencyKey (e.g. two dispatches on one table) would
      // each run their full window concurrently instead of sharing the cap.
      const { concurrencyKey, concurrencyLimit } = item.options ?? {}
      const run = async () => {
        if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
          await acquireSlot(concurrencyKey, concurrencyLimit)
          try {
            await runner(item.payload, controller.signal)
          } finally {
            releaseSlot(concurrencyKey)
          }
          return
        }
        await runner(item.payload, controller.signal)
      }
      return run().catch((err) => {
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

  private async claimInlineJob<TPayload>(
    jobId: string,
    claimToken: string
  ): Promise<InlineClaimResult<TPayload>> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < INLINE_CLAIM_ATTEMPTS; attempt += 1) {
      try {
        const now = new Date()
        const leaseCutoff = new Date(now.getTime() - INLINE_CLAIM_LEASE_MS)
        const claimed = await db
          .update(asyncJobs)
          .set({
            status: JOB_STATUS.PROCESSING,
            startedAt: now,
            attempts: sql`${asyncJobs.attempts} + 1`,
            metadata: sql`coalesce(${asyncJobs.metadata}, '{}'::jsonb) || jsonb_build_object(
              '__sim',
              coalesce(${asyncJobs.metadata} -> '__sim', '{}'::jsonb) || jsonb_build_object(
                'inlineClaim',
                jsonb_build_object('token', ${claimToken}, 'claimedAt', ${now.toISOString()})
              )
            )`,
            updatedAt: now,
          })
          .where(
            and(
              eq(asyncJobs.id, jobId),
              or(
                eq(asyncJobs.status, JOB_STATUS.PENDING),
                and(
                  eq(asyncJobs.status, JOB_STATUS.PROCESSING),
                  lte(asyncJobs.updatedAt, leaseCutoff)
                )
              )
            )
          )
          .returning({ payload: asyncJobs.payload })
        if (claimed.length > 0) {
          return { state: 'owned', payload: claimed[0].payload as TPayload }
        }
      } catch (error) {
        lastError = toError(error)
      }

      try {
        const [row] = await db
          .select({
            metadata: asyncJobs.metadata,
            payload: asyncJobs.payload,
            status: asyncJobs.status,
            updatedAt: asyncJobs.updatedAt,
          })
          .from(asyncJobs)
          .where(eq(asyncJobs.id, jobId))
          .limit(1)

        if (!row) return { state: 'settled' }
        if (row.status === JOB_STATUS.PENDING) continue
        if (row.status !== JOB_STATUS.PROCESSING) {
          return { state: 'settled' }
        }

        if (getInlineClaimToken(row.metadata) === claimToken) {
          return { state: 'owned', payload: row.payload as TPayload }
        }
        if (row.updatedAt.getTime() <= Date.now() - INLINE_CLAIM_LEASE_MS) continue
        return { state: 'active' }
      } catch (error) {
        lastError = toError(error)
      }
    }

    throw lastError ?? new Error(`Unable to claim inline job ${jobId}`)
  }

  private claimFence(jobId: string, claimToken: string) {
    return and(
      eq(asyncJobs.id, jobId),
      eq(asyncJobs.status, JOB_STATUS.PROCESSING),
      sql`${asyncJobs.metadata} #>> '{__sim,inlineClaim,token}' = ${claimToken}`
    )
  }

  private async completeInlineJob(jobId: string, claimToken: string): Promise<void> {
    const now = new Date()
    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.COMPLETED,
        completedAt: now,
        output: null,
        updatedAt: now,
      })
      .where(this.claimFence(jobId, claimToken))
  }

  private async failInlineJob(jobId: string, claimToken: string, error: string): Promise<void> {
    const now = new Date()
    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.FAILED,
        completedAt: now,
        error,
        updatedAt: now,
      })
      .where(this.claimFence(jobId, claimToken))
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
   * Claims the persisted job before returning, then owns its inline lifecycle.
   * The detached runner renews the claim while queued or running and all
   * terminal writes are fenced by the claim token.
   */
  private async startInline<TPayload>(
    type: JobType,
    jobId: string,
    runner: Runner,
    concurrencyKey?: string,
    concurrencyLimit?: number
  ): Promise<void> {
    const abortController = new AbortController()
    const claimToken = generateShortId(20)
    let claim: InlineClaimResult<TPayload>

    try {
      claim = await this.claimInlineJob<TPayload>(jobId, claimToken)
    } catch (error) {
      throw new AsyncJobEnqueueError(
        `Unable to establish ownership of database job: ${toError(error).message}`,
        {
          acceptance: 'unknown',
          retryable: true,
          cause: error,
        }
      )
    }

    if (claim.state === 'settled') return
    if (claim.state === 'active') return

    inlineAbortControllers.get(jobId)?.abort('Inline job claim superseded')
    inlineAbortControllers.set(jobId, abortController)
    let leaseValidUntil = Date.now() + INLINE_CLAIM_LEASE_MS
    let heartbeatInFlight = false
    const heartbeat = setInterval(() => {
      if (Date.now() >= leaseValidUntil) {
        abortController.abort('Inline job claim expired')
        return
      }
      if (heartbeatInFlight) return
      heartbeatInFlight = true
      void db
        .update(asyncJobs)
        .set({ updatedAt: new Date() })
        .where(this.claimFence(jobId, claimToken))
        .returning({ id: asyncJobs.id })
        .then((renewed) => {
          if (renewed.length === 0) {
            abortController.abort('Inline job claim lost')
            return
          }
          leaseValidUntil = Date.now() + INLINE_CLAIM_LEASE_MS
        })
        .catch((error) => {
          logger.warn(`[${type}] Failed to renew inline job ${jobId} claim`, {
            error: toError(error).message,
          })
          if (Date.now() >= leaseValidUntil) {
            abortController.abort('Inline job claim expired')
          }
        })
        .finally(() => {
          heartbeatInFlight = false
        })
    }, INLINE_CLAIM_HEARTBEAT_MS)
    heartbeat.unref()

    void (async () => {
      if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
        await acquireSlot(concurrencyKey, concurrencyLimit)
      }
      try {
        try {
          await runner(claim.payload, abortController.signal)
          await this.completeInlineJob(jobId, claimToken)
        } catch (error) {
          const message = toError(error).message
          logger.error(`[${type}] Inline job ${jobId} failed`, { error: message })
          try {
            await this.failInlineJob(jobId, claimToken, message)
          } catch (markError) {
            logger.error(`[${type}] Failed to mark inline job ${jobId} as failed`, {
              error: toError(markError).message,
            })
          }
        }
      } finally {
        clearInterval(heartbeat)
        if (inlineAbortControllers.get(jobId) === abortController) {
          inlineAbortControllers.delete(jobId)
        }
        if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
          releaseSlot(concurrencyKey)
        }
      }
    })()
  }
}
