/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordCancellationResult } = vi.hoisted(() => ({
  mockRecordCancellationResult: vi.fn(),
}))

vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordExecutionCancellationBackendResult: mockRecordCancellationResult,
}))

vi.mock('@sim/db', () => ({
  asyncJobs: {
    attempts: 'attempts',
    id: 'id',
    metadata: 'metadata',
    payload: 'payload',
    status: 'status',
    type: 'type',
  },
  db: dbChainMock.db,
}))

import { DatabaseJobQueue } from '@/lib/core/async-jobs/backends/database'
import {
  AsyncJobEnqueueError,
  MAX_JOB_DURATION_SECONDS,
  MIN_JOB_DURATION_SECONDS,
} from '@/lib/core/async-jobs/types'

const EXISTING_JOB = {
  id: 'workflow:1',
  type: 'workflow-execution',
  payload: { executionId: 'execution-1' },
  status: 'pending',
  createdAt: new Date('2026-07-10T00:00:00.000Z'),
  startedAt: null,
  completedAt: null,
  attempts: 0,
  maxAttempts: 3,
  error: null,
  output: null,
  metadata: {},
}

describe('DatabaseJobQueue enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the deterministic job ID when verification finds an accepted insert', async () => {
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('connection lost'))
    dbChainMockFns.limit.mockResolvedValueOnce([EXISTING_JOB])
    const queue = new DatabaseJobQueue()

    await expect(
      queue.enqueue('workflow-execution', { executionId: 'execution-1' }, { jobId: 'workflow:1' })
    ).resolves.toBe('workflow:1')
  })

  it('proves non-acceptance when verification succeeds without finding the job', async () => {
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('insert rejected'))
    dbChainMockFns.limit.mockResolvedValueOnce([])
    const queue = new DatabaseJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'rejected',
      retryable: true,
    })
  })

  it('reports ambiguous acceptance when insert verification also fails', async () => {
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(new Error('connection lost'))
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
    const queue = new DatabaseJobQueue()

    const error = await queue
      .enqueue('workflow-execution', {}, { jobId: 'workflow:1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(AsyncJobEnqueueError)
    expect(error).toMatchObject({
      acceptance: 'unknown',
      retryable: true,
    })
  })

  it('persists maxDurationSeconds alongside caller metadata', async () => {
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      {
        maxDurationSeconds: 3600,
        metadata: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          maxDurationSeconds: 3600,
        },
      })
    )
  })

  it.each([0, -1, 1.5, 4, MAX_JOB_DURATION_SECONDS + 1, Number.POSITIVE_INFINITY])(
    'rejects invalid maxDurationSeconds %s before inserting',
    async (maxDurationSeconds) => {
      const queue = new DatabaseJobQueue()

      const error = await queue
        .enqueue('workflow-execution', {}, { maxDurationSeconds })
        .catch((cause: unknown) => cause)

      expect(error).toMatchObject({ acceptance: 'rejected', retryable: false })
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )

  it('accepts the five-second minimum duration', async () => {
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      {},
      {
        maxDurationSeconds: MIN_JOB_DURATION_SECONDS,
      }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { maxDurationSeconds: MIN_JOB_DURATION_SECONDS },
      })
    )
  })

  it('does not allow caller metadata to impersonate the reserved duration field', async () => {
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      {},
      {
        metadata: { maxDurationSeconds: -1 },
      }
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }))
  })
})

describe('DatabaseJobQueue batchEnqueueAndWait', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('caps overlapping batches sharing a concurrencyKey at the shared limit', async () => {
    const queue = new DatabaseJobQueue()
    let inFlight = 0
    let maxInFlight = 0
    const makeItem = () => ({
      payload: {},
      options: {
        concurrencyKey: 'table-1',
        concurrencyLimit: 2,
        runner: async () => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await sleep(1)
          inFlight -= 1
        },
      },
    })

    await Promise.all([
      queue.batchEnqueueAndWait('workflow-group-cell', [makeItem(), makeItem()]),
      queue.batchEnqueueAndWait('workflow-group-cell', [makeItem(), makeItem()]),
    ])

    expect(maxInFlight).toBe(2)
  })

  it('rejects every invalid duration before starting any runner', async () => {
    const queue = new DatabaseJobQueue()
    const runner = vi.fn()

    await expect(
      queue.batchEnqueueAndWait('workflow-execution', [
        { payload: {}, options: { maxDurationSeconds: 60, runner } },
        { payload: {}, options: { maxDurationSeconds: 1.5, runner } },
      ])
    ).rejects.toMatchObject({ acceptance: 'rejected', retryable: false })

    expect(runner).not.toHaveBeenCalled()
  })

  it('aborts an in-process runner by execution ID', async () => {
    const queue = new DatabaseJobQueue()
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let observedSignal: AbortSignal | undefined

    const batch = queue.batchEnqueueAndWait('workflow-execution', [
      {
        payload: { workflowId: 'workflow-1', executionId: 'execution-1' },
        options: {
          runner: async (_payload, signal) => {
            observedSignal = signal
            resolveStarted?.()
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
          },
        },
      },
    ])
    await started
    dbChainMockFns.where.mockResolvedValueOnce({ count: 0 })

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(1)
    await batch

    expect(observedSignal?.aborted).toBe(true)
  })

  it('correlates legacy resume runners through their parent execution ID', async () => {
    const queue = new DatabaseJobQueue()
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let observedSignal: AbortSignal | undefined

    const batch = queue.batchEnqueueAndWait('resume-execution', [
      {
        payload: {
          workflowId: 'workflow-1',
          parentExecutionId: 'parent-execution-1',
          resumeExecutionId: 'resume-attempt-1',
        },
        options: {
          metadata: {
            workflowId: 'workflow-1',
            correlation: {
              executionId: 'resume-attempt-1',
              requestId: 'request-1',
              source: 'workflow',
              workflowId: 'workflow-1',
            },
          },
          runner: async (_payload, signal) => {
            observedSignal = signal
            resolveStarted?.()
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
          },
        },
      },
    ])
    await started
    dbChainMockFns.where.mockResolvedValueOnce({ count: 0 })

    await expect(
      queue.cancelByExecution(
        {
          workflowId: 'workflow-1',
          executionId: 'parent-execution-1',
        },
        'resume'
      )
    ).resolves.toBe(1)
    await batch

    expect(observedSignal?.aborted).toBe(true)
  })

  it('does not abort a shared workflow-group carrier through standalone cancellation', async () => {
    const queue = new DatabaseJobQueue()
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let observedSignal: AbortSignal | undefined

    const batch = queue.batchEnqueueAndWait('workflow-group-cell', [
      {
        payload: { workflowId: 'workflow-1', executionId: 'execution-1' },
        options: {
          cancelKey: 'table-1:row-1:group-1',
          runner: async (_payload, signal) => {
            observedSignal = signal
            resolveStarted?.()
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
          },
        },
      },
    ])
    await started
    dbChainMockFns.where.mockResolvedValueOnce({ count: 0 })

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(0)
    expect(observedSignal?.aborted).toBe(false)

    expect(queue.cancelByKey('table-1:row-1:group-1')).toBe(true)
    await batch
    expect(observedSignal?.aborted).toBe(true)
  })

  it('does not misclassify an abort rejection as a failed job', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'job-1' }])
    const queue = new DatabaseJobQueue()
    const markJobFailed = vi.spyOn(queue, 'markJobFailed')
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })

    await queue.enqueue(
      'workflow-execution',
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      {
        runner: async (_payload, signal) => {
          resolveStarted?.()
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
      }
    )
    await started
    dbChainMockFns.where.mockResolvedValueOnce({ count: 1 })
    await queue.cancelByExecution(
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      'standalone'
    )
    await sleep(1)

    expect(markJobFailed).not.toHaveBeenCalled()
  })
})

describe('DatabaseJobQueue batchEnqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('validates every row before inserting the batch', async () => {
    const queue = new DatabaseJobQueue()

    await expect(
      queue.batchEnqueue('workflow-execution', [
        { payload: {}, options: { maxDurationSeconds: 60 } },
        { payload: {}, options: { maxDurationSeconds: 1.5 } },
      ])
    ).rejects.toMatchObject({ acceptance: 'rejected', retryable: false })

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('DatabaseJobQueue inline claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('does not execute the runner when the pending start claim is lost', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const queue = new DatabaseJobQueue()
    const startJob = vi.spyOn(queue, 'startJob')
    const runner = vi.fn()

    await queue.enqueue(
      'workflow-execution',
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      { runner }
    )

    await vi.waitFor(() => expect(startJob).toHaveBeenCalledOnce())
    await startJob.mock.results[0]?.value
    expect(runner).not.toHaveBeenCalled()
  })

  it('marks an inline resume timeout as a failed job', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'resume-job-1' }])
    const queue = new DatabaseJobQueue()
    const timeoutError = Object.assign(new Error('Execution timed out after 5 minutes'), {
      name: 'TimeoutError',
    })

    await queue.enqueue(
      'resume-execution',
      { workflowId: 'workflow-1', parentExecutionId: 'execution-1' },
      {
        runner: async () => {
          throw timeoutError
        },
      }
    )

    await vi.waitFor(() =>
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: 'Execution timed out after 5 minutes',
          completedAt: expect.any(Date),
        })
      )
    )
  })

  it('does not execute after cancellation wins while the start claim is pending', async () => {
    const queue = new DatabaseJobQueue()
    let resolveClaim: ((claimed: boolean) => void) | undefined
    const claimPending = new Promise<boolean>((resolve) => {
      resolveClaim = resolve
    })
    const startJob = vi.spyOn(queue, 'startJob').mockReturnValue(claimPending)
    const runner = vi.fn()

    await queue.enqueue(
      'webhook-execution',
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      { runner }
    )
    await vi.waitFor(() => expect(startJob).toHaveBeenCalledOnce())
    dbChainMockFns.where.mockResolvedValueOnce({ count: 1 })

    await queue.cancelByExecution(
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      'standalone'
    )
    resolveClaim?.(true)
    await claimPending
    await sleep(1)

    expect(runner).not.toHaveBeenCalled()
  })
})

describe('DatabaseJobQueue cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('marks active database jobs as cancelled by execution ID', async () => {
    dbChainMockFns.where.mockResolvedValueOnce({ count: 1 })
    const queue = new DatabaseJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(1)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        completedAt: expect.any(Date),
        error: 'Cancelled',
      })
    )
    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'database',
      result: 'cancelled',
    })
  })

  it('records not-found when no active database job matches', async () => {
    dbChainMockFns.where.mockResolvedValueOnce({ count: 0 })
    const queue = new DatabaseJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(0)
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'database',
      result: 'not_found',
    })
  })

  it('returns the exact affected-row count without materializing job IDs', async () => {
    dbChainMockFns.where.mockResolvedValueOnce({ count: 37 })
    const queue = new DatabaseJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).resolves.toBe(37)

    expect(dbChainMockFns.returning).not.toHaveBeenCalled()
  })

  it('records an error when database cancellation fails', async () => {
    dbChainMockFns.where.mockRejectedValueOnce(new Error('database unavailable'))
    const queue = new DatabaseJobQueue()

    await expect(
      queue.cancelByExecution(
        { workflowId: 'workflow-1', executionId: 'execution-1' },
        'standalone'
      )
    ).rejects.toThrow('database unavailable')
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'database',
      result: 'error',
    })
  })
})
