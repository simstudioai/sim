/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  asyncJobs: {
    attempts: 'attempts',
    id: 'id',
    metadata: 'metadata',
    status: 'status',
  },
  db: dbChainMock.db,
}))

vi.mock('@sim/utils/id', () => ({
  generateShortId: vi.fn(() => 'inline-claim-token'),
}))

import { DatabaseJobQueue } from '@/lib/core/async-jobs/backends/database'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'

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
    dbChainMockFns.onConflictDoNothing.mockImplementationOnce(() => {
      throw new Error('connection lost')
    })
    dbChainMockFns.limit.mockResolvedValueOnce([EXISTING_JOB])
    const queue = new DatabaseJobQueue()

    await expect(
      queue.enqueue('workflow-execution', { executionId: 'execution-1' }, { jobId: 'workflow:1' })
    ).resolves.toBe('workflow:1')
  })

  it('proves non-acceptance when verification succeeds without finding the job', async () => {
    dbChainMockFns.onConflictDoNothing.mockImplementationOnce(() => {
      throw new Error('insert rejected')
    })
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
    dbChainMockFns.onConflictDoNothing.mockImplementationOnce(() => {
      throw new Error('connection lost')
    })
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

  it('starts the inline runner with the persisted job payload', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      { payload: { executionId: 'persisted-execution' } },
    ])
    const runner = vi.fn().mockResolvedValue(undefined)
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      { jobId: 'workflow:1', runner }
    )
    await sleep(1)

    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith(
      { executionId: 'persisted-execution' },
      expect.any(AbortSignal)
    )
  })

  it('does not restart the inline runner for a duplicate job id', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const runner = vi.fn().mockResolvedValue(undefined)
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      { jobId: 'workflow:1', runner }
    )
    await sleep(1)

    expect(runner).not.toHaveBeenCalled()
  })

  it('claims and runs a verified ambiguously accepted job', async () => {
    dbChainMockFns.onConflictDoNothing.mockImplementationOnce(() => {
      throw new Error('connection lost')
    })
    dbChainMockFns.limit.mockResolvedValueOnce([EXISTING_JOB])
    dbChainMockFns.returning.mockResolvedValueOnce([{ payload: EXISTING_JOB.payload }])
    const runner = vi.fn().mockResolvedValue(undefined)
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      { jobId: 'workflow:1', runner }
    )
    await sleep(1)

    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('runs after verifying a claim whose committed response was lost', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('claim response lost'))
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        status: 'processing',
        metadata: { __sim: { inlineClaim: { token: 'inline-claim-token' } } },
        payload: EXISTING_JOB.payload,
        updatedAt: new Date(),
      },
    ])
    const runner = vi.fn().mockResolvedValue(undefined)
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      { jobId: 'workflow:1', runner }
    )
    await sleep(1)

    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('leaves a job claimed by another inline runner unchanged', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('claim failed'))
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        status: 'processing',
        metadata: { __sim: { inlineClaim: { token: 'another-runner' } } },
        payload: EXISTING_JOB.payload,
        updatedAt: new Date(),
      },
    ])
    const runner = vi.fn().mockResolvedValue(undefined)
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      { jobId: 'workflow:1', runner }
    )
    await sleep(1)

    expect(runner).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
  })

  it('takes over an expired processing claim', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ payload: EXISTING_JOB.payload }])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        status: 'processing',
        metadata: { __sim: { inlineClaim: { token: 'expired-runner' } } },
        payload: EXISTING_JOB.payload,
        updatedAt: new Date(0),
      },
    ])
    const runner = vi.fn().mockResolvedValue(undefined)
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'different-caller-payload' },
      { jobId: 'workflow:1', runner }
    )
    await sleep(1)

    expect(runner).toHaveBeenCalledWith(EXISTING_JOB.payload, expect.any(AbortSignal))
  })

  it('aborts the runner when a heartbeat discovers that the claim was lost', async () => {
    vi.useFakeTimers()
    try {
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ payload: EXISTING_JOB.payload }])
        .mockResolvedValueOnce([])
      let runnerSignal: AbortSignal | undefined
      const runner = vi.fn(
        async (_payload: unknown, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            runnerSignal = signal
            signal.addEventListener('abort', () => reject(new Error('claim lost')), { once: true })
          })
      )
      const queue = new DatabaseJobQueue()

      await queue.enqueue(
        'workflow-execution',
        { executionId: 'execution-1' },
        { jobId: 'workflow:1', runner }
      )
      await vi.advanceTimersByTimeAsync(30_000)

      expect(runnerSignal?.aborted).toBe(true)
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      )
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts the runner when a heartbeat query hangs past the claim lease', async () => {
    vi.useFakeTimers()
    try {
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ payload: EXISTING_JOB.payload }])
        .mockImplementationOnce(() => new Promise(() => {}))
      let runnerSignal: AbortSignal | undefined
      const runner = vi.fn(
        async (_payload: unknown, signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            runnerSignal = signal
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
      )
      const queue = new DatabaseJobQueue()

      await queue.enqueue(
        'workflow-execution',
        { executionId: 'execution-1' },
        { jobId: 'workflow:1', runner }
      )
      await vi.advanceTimersByTimeAsync(120_000)

      expect(runnerSignal?.aborted).toBe(true)
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      )
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps explicit cancellation terminal while the runner stops cooperatively', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ payload: EXISTING_JOB.payload }])
    const runner = vi.fn(
      async (_payload: unknown, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
    )
    const queue = new DatabaseJobQueue()

    await queue.enqueue(
      'workflow-execution',
      { executionId: 'execution-1' },
      { jobId: 'workflow:1', runner }
    )
    await queue.cancelJob('workflow:1')
    await sleep(1)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Cancelled' })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    )
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
})
