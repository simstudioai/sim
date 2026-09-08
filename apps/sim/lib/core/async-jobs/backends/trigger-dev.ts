import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { toError } from '@sim/utils/errors'
import { taskContext } from '@trigger.dev/core/v3'
import { ApiError, runs, type TriggerOptions, tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import {
  AsyncJobEnqueueError,
  type EnqueueOptions,
  EXECUTION_JOB_TYPES_BY_CANCELLATION_SCOPE,
  type ExecutionJobBinding,
  type ExecutionJobCancellationScope,
  JOB_PENDING_RETENTION_HOURS,
  JOB_STATUS,
  type Job,
  type JobMetadata,
  type JobQueueBackend,
  type JobStatus,
  type JobType,
  TERMINAL_JOB_STATUSES,
  validateMaxDurationSeconds,
} from '@/lib/core/async-jobs/types'
import { recordExecutionCancellationBackendResult } from '@/lib/core/execution-limits/metrics'

const logger = createLogger('TriggerDevJobQueue')
const ACTIVE_TRIGGER_RUN_STATUSES = [
  'PENDING_VERSION',
  'DELAYED',
  'QUEUED',
  'DEQUEUED',
  'EXECUTING',
  'WAITING',
] as const
const CANCELLATION_LIST_PAGE_SIZE = 25
const CANCELLATION_OPERATION_CHUNK_SIZE = 10
function classifyTriggerEnqueueError(error: unknown): AsyncJobEnqueueError {
  if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
    return new AsyncJobEnqueueError(toError(error).message, {
      acceptance: 'rejected',
      retryable: error.status === 408 || error.status === 409 || error.status === 429,
      cause: error,
    })
  }

  return new AsyncJobEnqueueError(toError(error).message, {
    acceptance: 'unknown',
    retryable: true,
    cause: error,
  })
}

function buildExecutionTag(executionId: string): string {
  const tag = `executionId:${executionId}`
  return tag.length <= 128 ? tag : `executionIdHash:${sha256Hex(executionId)}`
}

function buildWorkflowTag(workflowId: string): string {
  const tag = `workflowId:${workflowId}`
  return tag.length <= 128 ? tag : `workflowIdHash:${sha256Hex(workflowId)}`
}

function payloadMatchesExecution(payload: unknown, binding: ExecutionJobBinding): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  const correlation =
    typeof record.correlation === 'object' && record.correlation !== null
      ? (record.correlation as Record<string, unknown>)
      : undefined
  const executionIds = [
    record.executionId,
    record.parentExecutionId,
    record.resumeExecutionId,
    correlation?.executionId,
  ]
  const workflowIds = [record.workflowId, correlation?.workflowId]

  return (
    executionIds.some((value) => value === binding.executionId) &&
    workflowIds.some((value) => value === binding.workflowId)
  )
}

interface CancellationCandidate {
  id: string
  verifyPayload: boolean
}

interface CancellationScanState {
  cancelledJobs: number
  failureCount: number
  firstError?: Error
}

interface CancellationListRun {
  id: string
  tags: string[]
  taskIdentifier: string
}

interface CancellationScanOptions {
  binding: ExecutionJobBinding
  cancelJob: (jobId: string) => Promise<void>
  listRuns: () => AsyncIterable<CancellationListRun>
  selectCandidate: (run: CancellationListRun) => CancellationCandidate | undefined
  state: CancellationScanState
}

function recordCancellationCandidateFailure(state: CancellationScanState, error: unknown): void {
  state.failureCount += 1
  state.firstError ??= toError(error)
}

async function processCancellationCandidateBatch(
  candidates: readonly CancellationCandidate[],
  binding: ExecutionJobBinding,
  state: CancellationScanState,
  cancelJob: (jobId: string) => Promise<void>
): Promise<void> {
  const batchIds = new Set<string>()
  const uniqueCandidates = candidates.filter((candidate) => {
    if (batchIds.has(candidate.id)) return false
    batchIds.add(candidate.id)
    return true
  })
  const results = await Promise.allSettled(
    uniqueCandidates.map(async (candidate) => {
      if (candidate.verifyPayload) {
        const legacyRun = await runs.retrieve(candidate.id)
        if (!payloadMatchesExecution(legacyRun.payload, binding)) return false
      }
      await cancelJob(candidate.id)
      return true
    })
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      recordCancellationCandidateFailure(state, result.reason)
    } else if (result.value) {
      state.cancelledJobs += 1
    }
  }
}

async function scanAndCancelTriggerRuns(options: CancellationScanOptions): Promise<void> {
  const candidates: CancellationCandidate[] = []

  const flushCandidates = async (): Promise<void> => {
    if (candidates.length === 0) return
    await processCancellationCandidateBatch(
      candidates,
      options.binding,
      options.state,
      options.cancelJob
    )
    candidates.length = 0
  }

  try {
    for await (const run of options.listRuns()) {
      const candidate = options.selectCandidate(run)
      if (!candidate) continue
      candidates.push(candidate)
      if (candidates.length >= CANCELLATION_OPERATION_CHUNK_SIZE) await flushCandidates()
    }
  } catch (error) {
    recordCancellationCandidateFailure(options.state, error)
  } finally {
    await flushCandidates()
  }
}

/**
 * Maps trigger.dev task IDs to our JobType
 */
const JOB_TYPE_TO_TASK_ID: Record<JobType, string> = {
  'workflow-execution': 'workflow-execution',
  'schedule-execution': 'schedule-execution',
  'webhook-execution': 'webhook-execution',
  'quickbooks-webhook-ingress': 'quickbooks-webhook-ingress',
  'resume-execution': 'resume-execution',
  'workflow-group-cell': 'workflow-group-cell',
  'cleanup-logs': 'cleanup-logs',
  'cleanup-soft-deletes': 'cleanup-soft-deletes',
  'cleanup-table-row-ttl': 'cleanup-table-row-ttl',
  'cleanup-tasks': 'cleanup-tasks',
  'run-data-drain': 'run-data-drain',
  'knowledge-connector-directory-sync': 'knowledge-connector-directory-sync',
}

/**
 * Maps trigger.dev run status to our JobStatus
 */
function mapTriggerDevStatus(status: string): JobStatus {
  switch (status) {
    case 'PENDING_VERSION':
    case 'DELAYED':
    case 'QUEUED':
      return JOB_STATUS.PENDING
    case 'DEQUEUED':
    case 'EXECUTING':
    case 'WAITING':
      return JOB_STATUS.PROCESSING
    case 'COMPLETED':
      return JOB_STATUS.COMPLETED
    case 'CANCELED':
      return JOB_STATUS.CANCELLED
    case 'FAILED':
    case 'CRASHED':
    case 'INTERRUPTED':
    case 'SYSTEM_FAILURE':
    case 'EXPIRED':
    case 'TIMED_OUT':
      return JOB_STATUS.FAILED
    default:
      return JOB_STATUS.PENDING
  }
}

/**
 * Dates the end of a run that trigger.dev already reports as terminal.
 *
 * A cancellation flips the run to `CANCELED` the moment it is accepted, but
 * `finishedAt` is only stamped once the worker actually drains — seconds later,
 * or never for a run that was cancelled before it was ever dequeued. A reader
 * polling inside that window sees a terminal job carrying no completion
 * instant, and every consumer that derives an end timestamp or an elapsed
 * duration from it reports null.
 *
 * `updatedAt` is trigger.dev's own record of when the run last changed, so for
 * a terminal run it dates that final transition rather than the read. It is
 * consulted only once the status is terminal: an active run's `updatedAt`
 * describes progress, not an ending, and reporting it would end a run that is
 * still going.
 */
function resolveRunCompletedAt(
  finishedAt: Date | string | undefined,
  updatedAt: Date | string | undefined,
  status: JobStatus
): Date | undefined {
  if (finishedAt) return new Date(finishedAt)
  if (!TERMINAL_JOB_STATUSES.includes(status)) return undefined
  return updatedAt ? new Date(updatedAt) : undefined
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
    const triggerOptions: TriggerOptions = {}
    if (tags.length > 0) triggerOptions.tags = tags
    const maxDuration = validateMaxDurationSeconds(options?.maxDurationSeconds)
    if (maxDuration !== undefined) triggerOptions.maxDuration = maxDuration
    if (options?.concurrencyKey) triggerOptions.concurrencyKey = options.concurrencyKey
    if (options?.jobId) {
      triggerOptions.idempotencyKey = options.jobId
      triggerOptions.idempotencyKeyTTL = '14d'
    }
    if (options?.delayMs && options.delayMs > 0) {
      triggerOptions.delay = new Date(Date.now() + options.delayMs)
    }
    try {
      triggerOptions.region = await resolveTriggerRegion()
    } catch (error) {
      throw new AsyncJobEnqueueError(toError(error).message, {
        acceptance: 'rejected',
        retryable: true,
        cause: error,
      })
    }

    let handle: Awaited<ReturnType<typeof tasks.trigger>>
    try {
      handle = await tasks.trigger(taskId, enrichedPayload, triggerOptions)
    } catch (error) {
      throw classifyTriggerEnqueueError(error)
    }

    logger.debug('Enqueued job via trigger.dev', { jobId: handle.id, type, taskId, tags })
    return handle.id
  }

  async batchEnqueue<TPayload>(
    type: JobType,
    items: Array<{ payload: TPayload; options?: EnqueueOptions }>
  ): Promise<string[]> {
    if (items.length === 0) return []
    for (const { options } of items) {
      validateMaxDurationSeconds(options?.maxDurationSeconds)
    }
    // tasks.batchTrigger returns only a batchId, not per-item run IDs, so we
    // can't use it when callers need to track individual runs (e.g. table cell
    // tasks need per-row jobIds for cancellation). Sequential `tasks.trigger`
    // gives us per-item IDs and naturally preserves input order in the queue.
    const ids: string[] = []
    for (const { payload, options } of items) {
      const id = await this.enqueue(type, payload, options)
      ids.push(id)
    }
    return ids
  }

  async batchEnqueueAndWait<TPayload>(
    type: JobType,
    items: Array<{ payload: TPayload; options?: EnqueueOptions }>
  ): Promise<string[]> {
    if (items.length === 0) return []
    for (const { options } of items) {
      validateMaxDurationSeconds(options?.maxDurationSeconds)
    }
    // The SDK's checkpoint-and-resume requires task runtime context. The only
    // caller (`dispatcherStep` invoked by `tableRunDispatcherTask.run`) is
    // always inside a task; check defensively so misuse fails at the boundary
    // instead of as a confusing SDK internal error.
    if (!taskContext.isInsideTask) {
      throw new Error(
        'batchEnqueueAndWait requires trigger.dev task runtime context — call from within a registered task'
      )
    }

    const taskId = JOB_TYPE_TO_TASK_ID[type]
    if (!taskId) throw new Error(`Unknown job type: ${type}`)

    const region = await resolveTriggerRegion()
    const batchItems = items.map(({ payload, options }) => {
      const enrichedPayload =
        options?.metadata && typeof payload === 'object' && payload !== null
          ? { ...payload, ...options.metadata }
          : payload
      const tags = buildTags(options)
      const batchItem: {
        payload: unknown
        options?: {
          concurrencyKey?: string
          maxDuration?: number
          tags?: string[]
          region?: string
        }
      } = { payload: enrichedPayload }
      const batchOpts: {
        concurrencyKey?: string
        maxDuration?: number
        tags?: string[]
        region?: string
      } = { region }
      if (options?.concurrencyKey) batchOpts.concurrencyKey = options.concurrencyKey
      const maxDuration = validateMaxDurationSeconds(options?.maxDurationSeconds)
      if (maxDuration !== undefined) batchOpts.maxDuration = maxDuration
      if (tags.length > 0) batchOpts.tags = tags
      batchItem.options = batchOpts
      return batchItem
    })

    const result = await tasks.batchTriggerAndWait(taskId, batchItems)
    logger.debug('batchTriggerAndWait completed', {
      type,
      taskId,
      runCount: result.runs.length,
    })
    return result.runs.map((r) => r.id)
  }

  async getJob(jobId: string): Promise<Job | null> {
    try {
      let run: Awaited<ReturnType<typeof runs.retrieve>>
      try {
        run = await runs.retrieve(jobId)
      } catch (error) {
        const isNotFound =
          (error instanceof Error && error.message.toLowerCase().includes('not found')) ||
          (error && typeof error === 'object' && 'status' in error && error.status === 404)
        if (!isNotFound) throw error

        let runId: string | undefined
        for await (const candidate of runs.list({ tag: `jobId:${jobId}`, limit: 1 })) {
          runId = candidate.id
          break
        }
        if (!runId) {
          logger.debug('Job not found in trigger.dev', { jobId })
          return null
        }
        run = await runs.retrieve(runId)
      }

      const payload = run.payload as Record<string, unknown>
      const metadata: JobMetadata = {
        workflowId: payload?.workflowId as string | undefined,
        userId: payload?.userId as string | undefined,
        correlation:
          payload?.correlation && typeof payload.correlation === 'object'
            ? (payload.correlation as JobMetadata['correlation'])
            : undefined,
      }

      const status = mapTriggerDevStatus(run.status)

      return {
        id: run.id,
        type: run.taskIdentifier as JobType,
        payload: run.payload,
        status,
        createdAt: run.createdAt ? new Date(run.createdAt) : new Date(),
        startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
        completedAt: resolveRunCompletedAt(run.finishedAt, run.updatedAt, status),
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

  async startJob(_jobId: string): Promise<boolean> {
    return true
  }

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

  async cancelByExecution(
    binding: ExecutionJobBinding,
    scope: ExecutionJobCancellationScope
  ): Promise<number> {
    const executionTag = buildExecutionTag(binding.executionId)
    const workflowTag = buildWorkflowTag(binding.workflowId)
    const allowedTaskIdentifiers = EXECUTION_JOB_TYPES_BY_CANCELLATION_SCOPE[scope]
    const isAllowedTask = (run: CancellationListRun) =>
      (allowedTaskIdentifiers as readonly string[]).includes(run.taskIdentifier)
    const cutoff = new Date(Date.now() - JOB_PENDING_RETENTION_HOURS * 60 * 60 * 1000)
    const state: CancellationScanState = {
      cancelledJobs: 0,
      failureCount: 0,
    }

    try {
      await scanAndCancelTriggerRuns({
        binding,
        cancelJob: (jobId) => this.cancelJob(jobId),
        listRuns: () =>
          runs.list({
            tag: [workflowTag, executionTag],
            status: [...ACTIVE_TRIGGER_RUN_STATUSES],
            from: cutoff,
            limit: CANCELLATION_LIST_PAGE_SIZE,
          }),
        selectCandidate: (run) =>
          isAllowedTask(run) && run.tags.includes(workflowTag) && run.tags.includes(executionTag)
            ? { id: run.id, verifyPayload: false }
            : undefined,
        state,
      })

      await scanAndCancelTriggerRuns({
        binding,
        cancelJob: (jobId) => this.cancelJob(jobId),
        listRuns: () =>
          runs.list({
            tag: workflowTag,
            status: [...ACTIVE_TRIGGER_RUN_STATUSES],
            from: cutoff,
            limit: CANCELLATION_LIST_PAGE_SIZE,
          }),
        selectCandidate: (run) => {
          if (
            !isAllowedTask(run) ||
            !run.tags.includes(workflowTag) ||
            run.tags.includes(executionTag)
          ) {
            return undefined
          }
          return { id: run.id, verifyPayload: true }
        },
        state,
      })

      await scanAndCancelTriggerRuns({
        binding,
        cancelJob: (jobId) => this.cancelJob(jobId),
        listRuns: () =>
          runs.list({
            taskIdentifier: [...allowedTaskIdentifiers],
            status: [...ACTIVE_TRIGGER_RUN_STATUSES],
            from: cutoff,
            limit: CANCELLATION_LIST_PAGE_SIZE,
          }),
        selectCandidate: (run) =>
          isAllowedTask(run) && run.tags.length === 0
            ? { id: run.id, verifyPayload: true }
            : undefined,
        state,
      })

      if (state.firstError) throw state.firstError

      logger.info('Cancelled trigger.dev runs for execution', {
        ...binding,
        scope,
        cancelledJobs: state.cancelledJobs,
      })
      recordExecutionCancellationBackendResult({
        backend: 'trigger_dev',
        result: state.cancelledJobs > 0 ? 'cancelled' : 'not_found',
      })
      return state.cancelledJobs
    } catch (error) {
      recordExecutionCancellationBackendResult({ backend: 'trigger_dev', result: 'error' })
      logger.error('Failed to cancel trigger.dev runs for execution', {
        ...binding,
        cancelledJobs: state.cancelledJobs,
        error: toError(error).message,
        failureCount: state.failureCount,
      })
      throw error
    }
  }

  cancelByKey(_cancelKey: string): boolean {
    // No in-process AbortControllers to abort — trigger.dev runs are cancelled
    // by jobId or via tag sweep (see `cancelCellRunsByTags`). Callers that
    // need both surfaces should fan out themselves.
    return false
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

  if (options?.jobId) tags.push(`jobId:${options.jobId}`)

  const executionId =
    meta?.correlation?.executionId ??
    (typeof meta?.executionId === 'string' ? meta.executionId : undefined)
  if (executionId) tags.push(buildExecutionTag(executionId))

  const workflowId =
    meta?.correlation?.workflowId ??
    (typeof meta?.workflowId === 'string' ? meta.workflowId : undefined)
  if (meta?.workspaceId) tags.push(`workspaceId:${meta.workspaceId}`)
  if (workflowId) tags.push(buildWorkflowTag(workflowId))
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
