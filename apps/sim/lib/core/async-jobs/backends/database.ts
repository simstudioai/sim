import { asyncJobs, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import {
  AsyncJobEnqueueError,
  type EnqueueOptions,
  EXECUTION_JOB_TYPES_BY_CANCELLATION_SCOPE,
  type ExecutionJobBinding,
  type ExecutionJobCancellationScope,
  JOB_STATUS,
  type Job,
  type JobMetadata,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
  validateMaxDurationSeconds,
} from '@/lib/core/async-jobs/types'
import { recordExecutionCancellationBackendResult } from '@/lib/core/execution-limits/metrics'

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
const inlineExecutionControllers = new Map<string, Map<AbortController, JobType>>()

/**
 * Per-cancel-key abort controllers for the `batchEnqueueAndWait` direct-call
 * path. Distinct from `inlineAbortControllers` (which keys by jobId) — this
 * map keys by the domain `cancelKey` callers pass in, since the await-blocking
 * path skips `async_jobs` entirely and has no jobId to cancel by.
 */
const inlineCancelKeyControllers = new Map<string, AbortController>()

function getExecutionBinding<TPayload>(
  payload: TPayload,
  options?: EnqueueOptions
): ExecutionJobBinding | undefined {
  const metadataExecutionId = options?.metadata?.executionId
  const metadataWorkflowId = options?.metadata?.workflowId
  const correlation = options?.metadata?.correlation
  let executionId =
    typeof metadataExecutionId === 'string' ? metadataExecutionId : correlation?.executionId
  let workflowId =
    typeof metadataWorkflowId === 'string' ? metadataWorkflowId : correlation?.workflowId

  if (typeof payload !== 'object' || payload === null) {
    return executionId && workflowId ? { executionId, workflowId } : undefined
  }

  const record = payload as Record<string, unknown>
  const payloadCorrelation =
    typeof record.correlation === 'object' && record.correlation !== null
      ? (record.correlation as Record<string, unknown>)
      : undefined
  if (typeof record.parentExecutionId === 'string') {
    executionId = record.parentExecutionId
  } else if (!executionId) {
    const payloadExecutionId =
      record.executionId ??
      record.parentExecutionId ??
      record.resumeExecutionId ??
      payloadCorrelation?.executionId
    if (typeof payloadExecutionId === 'string') executionId = payloadExecutionId
  }
  if (!workflowId) {
    const payloadWorkflowId = record.workflowId ?? payloadCorrelation?.workflowId
    if (typeof payloadWorkflowId === 'string') workflowId = payloadWorkflowId
  }
  return executionId && workflowId ? { executionId, workflowId } : undefined
}

function executionBindingKey(binding: ExecutionJobBinding): string {
  return JSON.stringify([binding.workflowId, binding.executionId])
}

function trackExecutionController(
  binding: ExecutionJobBinding,
  controller: AbortController,
  type: JobType
): void {
  const key = executionBindingKey(binding)
  const controllers = inlineExecutionControllers.get(key) ?? new Map<AbortController, JobType>()
  controllers.set(controller, type)
  inlineExecutionControllers.set(key, controllers)
}

function untrackExecutionController(
  binding: ExecutionJobBinding,
  controller: AbortController
): void {
  const key = executionBindingKey(binding)
  const controllers = inlineExecutionControllers.get(key)
  if (!controllers) return
  controllers.delete(controller)
  if (controllers.size === 0) inlineExecutionControllers.delete(key)
}

function buildJobMetadata(options?: EnqueueOptions): Record<string, unknown> {
  const maxDurationSeconds = validateMaxDurationSeconds(options?.maxDurationSeconds)
  return {
    ...omit(options?.metadata ?? {}, ['maxDurationSeconds']),
    ...(maxDurationSeconds !== undefined ? { maxDurationSeconds } : {}),
  }
}

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
    const metadata = buildJobMetadata(options)

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
          metadata,
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
      this.runInline(
        type,
        jobId,
        payload,
        options.runner,
        getExecutionBinding(payload, options),
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
      metadata: buildJobMetadata(options),
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
          getExecutionBinding(payload, options),
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
    for (const { options } of items) {
      validateMaxDurationSeconds(options?.maxDurationSeconds)
    }
    const tracked: Array<{ key: string; controller: AbortController }> = []
    const trackedExecutions: Array<{
      binding: ExecutionJobBinding
      controller: AbortController
    }> = []
    const runs = items.map((item) => {
      const runner = item.options?.runner
      if (!runner) return Promise.resolve()
      const controller = new AbortController()
      const cancelKey = item.options?.cancelKey
      if (cancelKey) {
        inlineCancelKeyControllers.set(cancelKey, controller)
        tracked.push({ key: cancelKey, controller })
      }
      const binding = getExecutionBinding(item.payload, item.options)
      if (binding) {
        trackExecutionController(binding, controller, type)
        trackedExecutions.push({ binding, controller })
      }
      // Same shared-key semaphore as `runInline`: without it, overlapping
      // batches on one concurrencyKey (e.g. two dispatches on one table) would
      // each run their full window concurrently instead of sharing the cap.
      const { concurrencyKey, concurrencyLimit } = item.options ?? {}
      const run = async () => {
        if (controller.signal.aborted) return
        if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
          await acquireSlot(concurrencyKey, concurrencyLimit)
          try {
            if (controller.signal.aborted) return
            await runner(item.payload, controller.signal)
          } finally {
            releaseSlot(concurrencyKey)
          }
          return
        }
        await runner(item.payload, controller.signal)
      }
      return run().catch((err) => {
        if (controller.signal.aborted) return
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
      for (const trackedExecution of trackedExecutions) {
        untrackExecutionController(trackedExecution.binding, trackedExecution.controller)
      }
    }
    return items.map(() => '')
  }

  async getJob(jobId: string): Promise<Job | null> {
    const [row] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, jobId)).limit(1)

    return row ? rowToJob(row) : null
  }

  async startJob(jobId: string): Promise<boolean> {
    const now = new Date()

    const [claimedJob] = await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.PROCESSING,
        startedAt: now,
        attempts: sql`${asyncJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(and(eq(asyncJobs.id, jobId), eq(asyncJobs.status, JOB_STATUS.PENDING)))
      .returning({ id: asyncJobs.id })

    if (!claimedJob) {
      logger.debug('Skipped job whose pending claim was lost', { jobId })
      return false
    }

    logger.debug('Started job', { jobId })
    return true
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
      .where(and(eq(asyncJobs.id, jobId), eq(asyncJobs.status, JOB_STATUS.PROCESSING)))

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
      .where(
        and(
          eq(asyncJobs.id, jobId),
          inArray(asyncJobs.status, [JOB_STATUS.PENDING, JOB_STATUS.PROCESSING])
        )
      )

    logger.debug('Marked job as failed', { jobId })
  }

  async cancelJob(jobId: string): Promise<void> {
    // Abort any in-process inline execution first so the running workflow
    // observes the signal and stops mid-flight. Then mark the row cancelled so
    // any future poller skips it without treating a user action as a failure.
    const controller = inlineAbortControllers.get(jobId)
    let aborted = false
    if (controller) {
      controller.abort(new DOMException('user', 'AbortError'))
      inlineAbortControllers.delete(jobId)
      aborted = true
    }

    const now = new Date()
    await db
      .update(asyncJobs)
      .set({
        status: JOB_STATUS.CANCELLED,
        completedAt: now,
        error: 'Cancelled',
        updatedAt: now,
      })
      .where(
        and(
          eq(asyncJobs.id, jobId),
          inArray(asyncJobs.status, [JOB_STATUS.PENDING, JOB_STATUS.PROCESSING])
        )
      )

    logger.debug('Marked job as cancelled (DB queue)', { jobId, abortedInline: aborted })
  }

  async cancelByExecution(
    binding: ExecutionJobBinding,
    scope: ExecutionJobCancellationScope
  ): Promise<number> {
    try {
      const key = executionBindingKey(binding)
      const controllers = inlineExecutionControllers.get(key)
      const allowedJobTypes = EXECUTION_JOB_TYPES_BY_CANCELLATION_SCOPE[scope]
      let abortedControllers = 0
      if (controllers) {
        for (const [controller, type] of controllers) {
          if (!(allowedJobTypes as readonly JobType[]).includes(type)) continue
          controller.abort(new DOMException('user', 'AbortError'))
          controllers.delete(controller)
          abortedControllers++
        }
        if (controllers.size === 0) inlineExecutionControllers.delete(key)
      }

      const now = new Date()
      const cancellationResult = await db
        .update(asyncJobs)
        .set({
          status: JOB_STATUS.CANCELLED,
          completedAt: now,
          error: 'Cancelled',
          updatedAt: now,
        })
        .where(
          and(
            inArray(asyncJobs.status, [JOB_STATUS.PENDING, JOB_STATUS.PROCESSING]),
            inArray(asyncJobs.type, [...allowedJobTypes]),
            and(
              or(
                sql`${asyncJobs.metadata}->>'executionId' = ${binding.executionId}`,
                sql`${asyncJobs.metadata}->'correlation'->>'executionId' = ${binding.executionId}`,
                sql`${asyncJobs.payload}->>'executionId' = ${binding.executionId}`,
                sql`${asyncJobs.payload}->>'parentExecutionId' = ${binding.executionId}`,
                sql`${asyncJobs.payload}->>'resumeExecutionId' = ${binding.executionId}`,
                sql`${asyncJobs.payload}->'correlation'->>'executionId' = ${binding.executionId}`
              ),
              or(
                sql`${asyncJobs.metadata}->>'workflowId' = ${binding.workflowId}`,
                sql`${asyncJobs.metadata}->'correlation'->>'workflowId' = ${binding.workflowId}`,
                sql`${asyncJobs.payload}->>'workflowId' = ${binding.workflowId}`,
                sql`${asyncJobs.payload}->'correlation'->>'workflowId' = ${binding.workflowId}`
              )
            )
          )
        )

      const cancelledRows = cancellationResult.count
      const cancelledJobs = Math.max(cancelledRows, abortedControllers)
      recordExecutionCancellationBackendResult({
        backend: 'database',
        result: cancelledJobs > 0 ? 'cancelled' : 'not_found',
      })
      logger.info('Cancelled database jobs for execution', {
        ...binding,
        scope,
        cancelledJobs: cancelledRows,
        abortedControllers,
      })
      return cancelledJobs
    } catch (error) {
      recordExecutionCancellationBackendResult({ backend: 'database', result: 'error' })
      throw error
    }
  }

  cancelByKey(cancelKey: string): boolean {
    const controller = inlineCancelKeyControllers.get(cancelKey)
    if (!controller) return false
    controller.abort(new DOMException('user', 'AbortError'))
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
    binding?: ExecutionJobBinding,
    concurrencyKey?: string,
    concurrencyLimit?: number
  ): void {
    if (inlineAbortControllers.has(jobId)) {
      logger.debug('Inline job is already active', { jobId })
      return
    }
    const abortController = new AbortController()
    inlineAbortControllers.set(jobId, abortController)
    if (binding) trackExecutionController(binding, abortController, type)
    void (async () => {
      if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
        await acquireSlot(concurrencyKey, concurrencyLimit)
      }
      try {
        if (abortController.signal.aborted) return
        const claimed = await this.startJob(jobId)
        if (!claimed) return
        if (abortController.signal.aborted) return
        const output = await runner(payload, abortController.signal)
        if (abortController.signal.aborted) return
        await this.completeJob(jobId, output ?? null)
      } catch (err) {
        if (abortController.signal.aborted) return
        const message = toError(err).message
        logger.error(`[${type}] Inline job ${jobId} failed`, { error: message })
        try {
          await this.markJobFailed(jobId, message)
        } catch (markErr) {
          logger.error(`[${type}] Failed to mark job ${jobId} as failed`, { markErr })
        }
      } finally {
        if (inlineAbortControllers.get(jobId) === abortController) {
          inlineAbortControllers.delete(jobId)
        }
        if (binding) untrackExecutionController(binding, abortController)
        if (concurrencyKey && concurrencyLimit && concurrencyLimit > 0) {
          releaseSlot(concurrencyKey)
        }
      }
    })()
  }
}
