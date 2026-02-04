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

export type JobType = 'workflow-execution' | 'schedule-execution' | 'webhook-execution'

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
  userId?: string
  [key: string]: unknown
}

export interface EnqueueOptions {
  maxAttempts?: number
  metadata?: JobMetadata
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
}

export type AsyncBackendType = 'trigger-dev' | 'redis' | 'database'
