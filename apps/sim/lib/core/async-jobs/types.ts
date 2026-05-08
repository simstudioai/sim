/**
 * Types and constants for the async job queue system
 */

/** Retention period for completed/failed jobs (in hours) */
export const JOB_RETENTION_HOURS = 24

/** Retention period for completed/failed jobs (in seconds, for Redis TTL) */
export const JOB_RETENTION_SECONDS = JOB_RETENTION_HOURS * 60 * 60

/** Max lifetime for jobs in Redis (in seconds) - cleanup for stuck pending/processing jobs */
export const JOB_MAX_LIFETIME_SECONDS = 48 * 60 * 60

export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS]

export type JobType =
  | 'workflow-execution'
  | 'schedule-execution'
  | 'webhook-execution'
  | 'resume-execution'
  | 'workflow-group-cell'
  | 'cleanup-logs'
  | 'cleanup-soft-deletes'
  | 'cleanup-tasks'
  | 'run-data-drain'

export type AsyncExecutionCorrelationSource = 'workflow' | 'schedule' | 'webhook'

export interface AsyncExecutionCorrelation {
  executionId: string
  requestId: string
  source: AsyncExecutionCorrelationSource
  workflowId: string
  triggerType?: string
  webhookId?: string
  scheduleId?: string
  path?: string
  provider?: string
  scheduledFor?: string
}

export interface Job<TPayload = unknown, TOutput = unknown> {
  id: string
  type: JobType
  payload: TPayload
  status: JobStatus
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  attempts: number
  maxAttempts: number
  error?: string
  output?: TOutput
  metadata: JobMetadata
}

export interface JobMetadata {
  workflowId?: string
  workspaceId?: string
  userId?: string
  correlation?: AsyncExecutionCorrelation
  [key: string]: unknown
}

export interface EnqueueOptions {
  maxAttempts?: number
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
  runner?: <TPayload>(payload: TPayload, signal: AbortSignal) => Promise<void>
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
   * Get a job by ID
   */
  getJob(jobId: string): Promise<Job | null>

  /**
   * Mark a job as started/processing
   */
  startJob(jobId: string): Promise<void>

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
}

export type AsyncBackendType = 'trigger-dev' | 'database'
