import { vi } from 'vitest'

/**
 * Mirrors `AsyncJobEnqueueError` from `@/lib/core/async-jobs`: same `name`, `acceptance`,
 * `retryable` and `cause`. Exposed on {@link asyncJobsMock} under the real export name, so
 * `instanceof` against the mocked export and the default `isAsyncJobEnqueueError` guard behave
 * like production.
 */
export class MockAsyncJobEnqueueError extends Error {
  readonly acceptance: 'rejected' | 'unknown'
  readonly retryable: boolean

  constructor(
    message: string,
    options: { acceptance: 'rejected' | 'unknown'; retryable: boolean; cause?: unknown }
  ) {
    super(message, { cause: options.cause })
    this.name = 'AsyncJobEnqueueError'
    this.acceptance = options.acceptance
    this.retryable = options.retryable
  }
}

/**
 * The shared job-queue backend that {@link asyncJobsMockFns.mockGetJobQueue} and
 * {@link asyncJobsMockFns.mockGetInlineJobQueue} resolve by default. Every method of
 * `JobQueueBackend` is a bare `vi.fn()`.
 */
export const mockJobQueue = {
  enqueue: vi.fn(),
  batchEnqueue: vi.fn(),
  batchEnqueueAndWait: vi.fn(),
  getJob: vi.fn(),
  startJob: vi.fn(),
  completeJob: vi.fn(),
  markJobFailed: vi.fn(),
  cancelJob: vi.fn(),
  cancelByExecution: vi.fn(),
  cancelByKey: vi.fn(),
}

/**
 * Controllable mock functions for `@/lib/core/async-jobs`.
 *
 * Defaults:
 * - `mockGetJobQueue` and `mockGetInlineJobQueue` resolve {@link mockJobQueue} (also exposed here
 *   as `mockJobQueue`).
 * - `mockShouldExecuteInline` returns `false` (the Trigger.dev path every local stub selects).
 * - `mockIsAsyncJobEnqueueError` matches any `Error` named `AsyncJobEnqueueError`.
 * - `mockGetAsyncBackendType`, `mockGetCurrentBackendType`, `mockResetJobQueueCache` are bare.
 *
 * @example
 * ```ts
 * import { asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
 *
 * asyncJobsMockFns.mockJobQueue.enqueue.mockResolvedValue('job-1')
 * ```
 */
export const asyncJobsMockFns = {
  mockJobQueue,
  mockGetAsyncBackendType: vi.fn(),
  mockGetCurrentBackendType: vi.fn(),
  mockGetInlineJobQueue: vi.fn(async (): Promise<typeof mockJobQueue> => mockJobQueue),
  mockGetJobQueue: vi.fn(async (): Promise<typeof mockJobQueue> => mockJobQueue),
  mockResetJobQueueCache: vi.fn(),
  mockShouldExecuteInline: vi.fn((): boolean => false),
  mockIsAsyncJobEnqueueError: vi.fn(
    (error: unknown): boolean => error instanceof Error && error.name === 'AsyncJobEnqueueError'
  ),
}

const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

/**
 * Static mock module for `@/lib/core/async-jobs`. Covers every runtime export; constants carry
 * the real values and `AsyncJobEnqueueError` is {@link MockAsyncJobEnqueueError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)
 * ```
 */
export const asyncJobsMock = {
  getAsyncBackendType: asyncJobsMockFns.mockGetAsyncBackendType,
  getCurrentBackendType: asyncJobsMockFns.mockGetCurrentBackendType,
  getInlineJobQueue: asyncJobsMockFns.mockGetInlineJobQueue,
  getJobQueue: asyncJobsMockFns.mockGetJobQueue,
  resetJobQueueCache: asyncJobsMockFns.mockResetJobQueueCache,
  shouldExecuteInline: asyncJobsMockFns.mockShouldExecuteInline,
  AsyncJobEnqueueError: MockAsyncJobEnqueueError,
  isAsyncJobEnqueueError: asyncJobsMockFns.mockIsAsyncJobEnqueueError,
  JOB_MAX_LIFETIME_SECONDS: 48 * 60 * 60,
  JOB_PENDING_RETENTION_HOURS: 14 * 24,
  JOB_RETENTION_HOURS: 24,
  JOB_RETENTION_SECONDS: 24 * 60 * 60,
  JOB_STATUS,
  MAX_JOB_DURATION_SECONDS: 2_147_483_647,
  MIN_JOB_DURATION_SECONDS: 5,
  TERMINAL_JOB_STATUSES: [JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED],
}
