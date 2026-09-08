/**
 * Types and constants for the async job queue system
 */

/** Retention period for terminal jobs (in hours) */
export const JOB_RETENTION_HOURS = 24

/** Retention period for terminal jobs (in seconds, for Redis TTL) */
export const JOB_RETENTION_SECONDS = JOB_RETENTION_HOURS * 60 * 60

/** Max lifetime for jobs in Redis (in seconds) - cleanup for stuck pending/processing jobs */
export const JOB_MAX_LIFETIME_SECONDS = 48 * 60 * 60

/** Queue-wait lease before a database job that never started is considered abandoned. */
export const JOB_PENDING_RETENTION_HOURS = 14 * 24

/** Trigger.dev's minimum supported per-run duration. */
export const MIN_JOB_DURATION_SECONDS = 5
/** Largest duration accepted by queue backends, keeping persisted-second arithmetic bounded. */
export const MAX_JOB_DURATION_SECONDS = 2_147_483_647

export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS]

/** The statuses a job cannot leave; every one of them requires a `completedAt`. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED,
]

export type JobType =
  | 'workflow-execution'
  | 'schedule-execution'
  | 'webhook-execution'
  | 'quickbooks-webhook-ingress'
  | 'resume-execution'
  | 'workflow-group-cell'
  | 'cleanup-logs'
  | 'cleanup-soft-deletes'
  | 'cleanup-table-row-ttl'
  | 'cleanup-tasks'
  | 'run-data-drain'
  | 'knowledge-connector-directory-sync'

export type AsyncExecutionCorrelationSource =
  | 'workflow'
  | 'schedule'
  | 'webhook'
  | 'custom_block'
  | 'workflow_group'

export interface AsyncExecutionCorrelation {
  executionId: string
  requestId: string
  source: AsyncExecutionCorrelationSource
  workflowId: string
  /** Server-validated binding for a browser-routed Copilot workflow tool execution. */
  copilotToolCallId?: string
  triggerType?: string
  webhookId?: string
  scheduleId?: string
  path?: string
  provider?: string
  scheduledFor?: string
  tableId?: string
  rowId?: string
  groupId?: string
  /**
   * Workspace of the invoking run. Set for custom-block children, whose invoker
   * lives in a different workspace than the log row this correlation lands on.
   */
  invokerWorkspaceId?: string
}

export interface WorkflowGroupExecutionCorrelation extends AsyncExecutionCorrelation {
  source: 'workflow_group'
  tableId: string
  rowId: string
  groupId: string
}

export interface Job<TPayload = unknown, TOutput = unknown> {
  id: string
  type: JobType
  payload: TPayload
  status: JobStatus
  createdAt: Date
  startedAt?: Date
  /**
   * When the job reached its current status, required whenever that status is
   * one of `TERMINAL_JOB_STATUSES`. Consumers derive both an end timestamp and
   * an elapsed duration from it, so a terminal job that omits it reports null
   * for each. A backend reading an eventually-consistent source must supply its
   * best-known transition instant rather than leaving this unset — never the
   * time of the read, which grows on every poll.
   */
  completedAt?: Date
  attempts: number
  maxAttempts: number
  error?: string
  output?: TOutput
  metadata: JobMetadata
}

export interface JobMetadata {
  executionId?: string
  workflowId?: string
  workspaceId?: string
  userId?: string
  correlation?: AsyncExecutionCorrelation
  [key: string]: unknown
}

export interface EnqueueOptions {
  maxAttempts?: number
  /** Per-run execution cap passed to Trigger.dev in seconds. */
  maxDurationSeconds?: number
  metadata?: JobMetadata
  jobId?: string
  priority?: number
  name?: string
  delayMs?: number
  tags?: string[]
  /**
   * Combined with the task's `queue.concurrencyLimit`, caps parallel runs
   * sharing this key. Trigger.dev enforces server-side; the database backend
   * enforces in-process via a FIFO semaphore.
   */
  concurrencyKey?: string
  /**
   * Per-key concurrency cap. Database backend only — trigger.dev reads this
   * from the task definition (`queue.concurrencyLimit`).
   */
  concurrencyLimit?: number
  /**
   * Job body invoked when the queue backend lacks an external worker.
   * Trigger.dev ignores this (its workers execute the task definition);
   * the database backend kicks it off as a fire-and-forget IIFE so the
   * row drives through `processing → completed | failed`. Receives the
   * payload and an `AbortSignal` driven by `cancelJob`.
   */
  runner?: <TPayload>(payload: TPayload, signal: AbortSignal) => Promise<unknown>
  /**
   * Stable identity for cancellation lookups on the database backend's
   * `batchEnqueueAndWait` path (which skips `async_jobs` entirely, so there
   * is no jobId to cancel by). Lets callers map a domain identity (e.g.
   * `tableId:rowId:groupId`) to the in-flight `AbortController`. Ignored
   * by trigger.dev — runs there are cancelled by tag or jobId.
   */
  cancelKey?: string
}

export interface ExecutionJobBinding {
  workflowId: string
  executionId: string
}

export type ExecutionJobCancellationScope = 'standalone' | 'resume'

export const EXECUTION_JOB_TYPES_BY_CANCELLATION_SCOPE = {
  standalone: ['workflow-execution', 'schedule-execution', 'webhook-execution'],
  resume: ['resume-execution'],
} as const satisfies Record<ExecutionJobCancellationScope, readonly JobType[]>

export type AsyncJobEnqueueAcceptance = 'rejected' | 'unknown'

interface AsyncJobEnqueueErrorOptions {
  acceptance: AsyncJobEnqueueAcceptance
  retryable: boolean
  cause?: unknown
}

/**
 * Describes whether a failed enqueue definitely did not create a job.
 *
 * `unknown` means the backend may have accepted the job before the response
 * failed, so callers must preserve ownership and retry only with a stable ID.
 */
export class AsyncJobEnqueueError extends Error {
  readonly acceptance: AsyncJobEnqueueAcceptance
  readonly retryable: boolean

  constructor(message: string, options: AsyncJobEnqueueErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'AsyncJobEnqueueError'
    this.acceptance = options.acceptance
    this.retryable = options.retryable
  }
}

/** Validates the per-run duration accepted by every job queue backend. */
export function validateMaxDurationSeconds(value?: number): number | undefined {
  if (value === undefined) return undefined
  if (
    !Number.isFinite(value) ||
    value < MIN_JOB_DURATION_SECONDS ||
    value > MAX_JOB_DURATION_SECONDS ||
    !Number.isInteger(value)
  ) {
    throw new AsyncJobEnqueueError(
      `maxDurationSeconds must be an integer between ${MIN_JOB_DURATION_SECONDS} and ${MAX_JOB_DURATION_SECONDS}`,
      {
        acceptance: 'rejected',
        retryable: false,
      }
    )
  }
  return value
}

export function isAsyncJobEnqueueError(error: unknown): error is AsyncJobEnqueueError {
  return error instanceof AsyncJobEnqueueError
}

/**
 * Backend interface for job queue implementations.
 * All backends must implement this interface.
 */
export interface JobQueueBackend {
  /**
   * Add a job to the queue
   */
  enqueue<TPayload>(type: JobType, payload: TPayload, options?: EnqueueOptions): Promise<string>

  /**
   * Enqueue multiple jobs as a single batch. Returns one jobId per item, in
   * input order. Backends preserve input order in queue dispatch (trigger.dev
   * via tasks.batchTrigger, database via a single multi-row INSERT).
   */
  batchEnqueue<TPayload>(
    type: JobType,
    items: Array<{ payload: TPayload; options?: EnqueueOptions }>
  ): Promise<string[]>

  /**
   * Enqueue a batch and block until every job has reached a terminal state
   * (completed, failed, or cancelled). The caller — typically a dispatcher
   * walking work in windows — uses this to gate window N+1 on window N's
   * completion.
   *
   * Backend implementations:
   * - Trigger.dev: wraps `tasks.batchTriggerAndWait`. MUST be called from
   *   inside a registered trigger.dev task (the SDK's checkpoint-and-resume
   *   requires task runtime context). Backends guard with
   *   `taskContext.isInsideTask` and throw a clear error otherwise.
   * - Database (in-process): bypasses `async_jobs` entirely. Since the
   *   caller is awaiting in-process, the row would serve no live purpose
   *   (no cross-process recovery, no by-id lookup, no semaphore needed —
   *   window size IS the concurrency cap). Calls the runner directly via
   *   `Promise.all` and resolves on the runner's exit.
   */
  batchEnqueueAndWait<TPayload>(
    type: JobType,
    items: Array<{ payload: TPayload; options?: EnqueueOptions }>
  ): Promise<string[]>

  /**
   * Get a job by ID
   */
  getJob(jobId: string): Promise<Job | null>

  /** Atomically claims a pending job for processing. Returns false when the claim was lost. */
  startJob(jobId: string): Promise<boolean>

  /**
   * Mark a job as completed with output
   */
  completeJob(jobId: string, output: unknown): Promise<void>

  /**
   * Mark a job as failed with error message
   */
  markJobFailed(jobId: string, error: string): Promise<void>

  /**
   * Request cancellation of a queued or running job. Best-effort: backends should
   * fail loudly if the underlying provider rejects, but a missing/unknown jobId
   * should resolve quietly so callers can drive cancel from possibly-stale state.
   */
  cancelJob(jobId: string): Promise<void>

  /**
   * Cancel queued or running jobs owned by an execution within the explicit
   * dedicated-job scope. Shared workflow-group carriers are never included.
   * Backends return the number of jobs or in-process runners they targeted.
   */
  cancelByExecution(
    binding: ExecutionJobBinding,
    scope: ExecutionJobCancellationScope
  ): Promise<number>

  /**
   * Cancel an in-flight job by its `cancelKey` (the domain identity callers
   * stamped on enqueue via `EnqueueOptions.cancelKey`). Used by
   * `batchEnqueueAndWait` paths that skip per-job ids; the trigger.dev
   * backend has no in-process AbortControllers to abort and returns `false`.
   * Returns `true` if a matching controller was found and aborted.
   */
  cancelByKey(cancelKey: string): boolean
}

export type AsyncBackendType = 'trigger-dev' | 'database'
