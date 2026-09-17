/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_DURABLE_LARGE_VALUE_BYTES } from '@/lib/execution/payloads/limits'

const {
  mockRead,
  mockInfo,
  mockDataRead,
  mockTransaction,
  mockUpdate,
  mockExternalize,
  mockReplaceReferences,
} = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockInfo: vi.fn(),
  mockDataRead: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdate: vi.fn(),
  mockExternalize: vi.fn(),
  mockReplaceReferences: vi.fn(),
}))

vi.mock('@sim/db', () => {
  const db = {
    select: () => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: mockRead,
      }
      return query
    },
    transaction: mockTransaction,
  }
  return { db, dbFor: () => db }
})

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: mockInfo, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  externalizeExecutionData: mockExternalize,
  stripSpanCosts: vi.fn(),
  TRACE_STORE_REF_KEY: 'traceStoreRef',
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  collectLargeValueReferenceKeys: () => ['stored-key'],
  replaceLargeValueReferenceKeysWithClient: mockReplaceReferences,
}))

import { backfillTraceStorage, parseArgs, runBackfillWorkers } from '@/scripts/backfill-trace-spans'

beforeEach(() => {
  vi.resetAllMocks()
  mockRead.mockImplementation((limit: number) =>
    limit === 0 ? Promise.resolve([]) : mockDataRead(limit)
  )
  mockDataRead.mockResolvedValue([])
  mockExternalize.mockResolvedValue({ traceStoreRef: { key: 'stored-key' } })
  mockTransaction.mockImplementation(async (callback) =>
    callback({
      update: () => ({ set: () => ({ where: mockUpdate }) }),
    })
  )
})

afterEach(() => vi.useRealTimers())

describe('backfill options', () => {
  it('defaults to four workers and supports a read-only check', () => {
    expect(parseArgs([])).toEqual({
      maxBatches: Number.POSITIVE_INFINITY,
      concurrency: 4,
      checkOnly: false,
    })
    expect(parseArgs(['--check-only', '--max-batches=2', '--concurrency=8'])).toEqual({
      maxBatches: 2,
      concurrency: 8,
      checkOnly: true,
    })
  })

  it.each([50, 64])('supports %i workers', (concurrency) => {
    expect(parseArgs([`--concurrency=${concurrency}`]).concurrency).toBe(concurrency)
  })

  it.each([
    '--max-batches=2junk',
    '--max-batches=1.5',
    '--max-batches=0',
    '--concurrency=65',
    '--concurrency=-1',
    '--concurrency=0',
    '--concurrency=2=3',
    '--unknown',
  ])('rejects invalid input: %s', (arg) => {
    expect(() => parseArgs([arg])).toThrow()
  })
})

describe('backfill workers', () => {
  it.each([2, 50, 64])(
    'bounds active work to %i workers and visits every candidate once',
    async (concurrency) => {
      let active = 0
      let peak = 0
      const visited: string[] = []
      const rows = Array.from({ length: 130 }, (_, index) => ({
        id: `log-${index}`,
      }))
      await runBackfillWorkers(rows, concurrency, async (row) => {
        active++
        peak = Math.max(peak, active)
        await Promise.resolve()
        visited.push(row.id)
        active--
      })
      expect(peak).toBe(concurrency)
      expect(visited.sort()).toEqual(rows.map((row) => row.id).sort())
    }
  )

  it('stops scheduling after a failure and drains writes already in flight', async () => {
    let finishWrite = () => {}
    const writing = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    const error = new Error('database unavailable')
    const started: string[] = []
    let completedWrite = false
    const rows = [1, 2, 3, 4].map((id) => ({ id: `log-${id}` }))
    const run = runBackfillWorkers(rows, 2, async ({ id }) => {
      started.push(id)
      if (id === 'log-2') throw error
      await writing
      completedWrite = true
    })
    const assertion = expect(run).rejects.toBe(error)
    await Promise.resolve()
    expect(started).toEqual(['log-1', 'log-2'])
    expect(completedWrite).toBe(false)
    finishWrite()
    await assertion
    expect(completedWrite).toBe(true)
    expect(started).toEqual(['log-1', 'log-2'])
  })
})

describe('trace backfill', () => {
  const options = { maxBatches: 1, concurrency: 1, checkOnly: false }
  const candidate = {
    id: 'log-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    workflowOwnerUserId: 'user-1',
    payloadBytes: 128,
    executionData: { traceSpans: [{ children: [{}] }] },
  }
  const candidateMetadata = { id: candidate.id }

  it('fails its schema check before uploading anything and preserves the database cause', async () => {
    const cause = new Error('column "size_bytes" does not exist')
    const error = new Error('Failed query', { cause })
    mockRead.mockRejectedValueOnce(error)
    await expect(backfillTraceStorage(options)).rejects.toBe(error)
    expect(mockDataRead).not.toHaveBeenCalled()
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('check-only performs no uploads, writes, or payload reads', async () => {
    await backfillTraceStorage({ ...options, checkOnly: true })
    expect(mockRead).toHaveBeenCalledTimes(5)
    expect(mockRead.mock.calls.every(([limit]) => limit === 0)).toBe(true)
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('commits a durable pointer and references with the recovered owner', async () => {
    mockDataRead.mockResolvedValueOnce([candidateMetadata]).mockResolvedValueOnce([candidate])
    await expect(backfillTraceStorage(options)).resolves.toEqual({
      migrated: 1,
      recoveredOwners: 1,
    })
    expect(mockExternalize).toHaveBeenCalledWith(
      expect.objectContaining({ hasTraceSpans: true, traceSpanCount: 2 }),
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
      },
      { throwOnError: true }
    )
    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockReplaceReferences).toHaveBeenCalledWith(
      expect.anything(),
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        source: 'execution_log',
      },
      ['stored-key']
    )
  })

  it('rejects an oversized payload before uploading or updating the log', async () => {
    mockDataRead.mockResolvedValueOnce([candidateMetadata]).mockResolvedValueOnce([
      {
        ...candidate,
        executionData: null,
        payloadBytes: MAX_DURABLE_LARGE_VALUE_BYTES + 1,
      },
    ])
    await expect(backfillTraceStorage(options)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('backfill limit') }),
    })
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('reports progress during a slow batch and removes the timer when finished', async () => {
    vi.useFakeTimers({ now: 0 })
    let markStarted = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let finishUpload = () => {}
    const upload = new Promise<void>((resolve) => {
      finishUpload = resolve
    })
    mockDataRead.mockResolvedValueOnce([candidateMetadata]).mockResolvedValueOnce([candidate])
    mockExternalize.mockImplementation(async () => {
      markStarted()
      await upload
      return { traceStoreRef: { key: 'stored-key' } }
    })
    const run = backfillTraceStorage(options)
    await started
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockInfo).toHaveBeenCalledWith(
      'Progress: migrated 0 | skipped 0 | 0.0 rows/s | elapsed 5s'
    )
    finishUpload()
    await run
    expect(mockInfo).toHaveBeenLastCalledWith(
      'Progress: migrated 1 | skipped 0 | 0.2 rows/s | elapsed 5s'
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts migrating after preflight without a full-table count or estimate', async () => {
    mockDataRead.mockResolvedValueOnce([candidateMetadata]).mockResolvedValueOnce([candidate])
    await backfillTraceStorage(options)
    expect(mockRead.mock.calls.map(([limit]) => limit)).toEqual([0, 0, 0, 0, 0, 100, 1])
    expect(mockExternalize).toHaveBeenCalledOnce()
  })

  it('keeps the candidate page at 100 rows with fifty workers', async () => {
    await backfillTraceStorage({ ...options, concurrency: 50 })
    expect(mockRead.mock.calls.map(([limit]) => limit)).toEqual([0, 0, 0, 0, 0, 100])
    expect(mockExternalize).not.toHaveBeenCalled()
  })

  it('does not update the log or start the next candidate after storage fails', async () => {
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata, { ...candidateMetadata, id: 'log-2' }])
      .mockResolvedValueOnce([candidate])
    const error = new Error('storage denied')
    mockExternalize.mockRejectedValueOnce(error)
    await expect(backfillTraceStorage(options)).rejects.toMatchObject({ cause: error })
    expect(mockExternalize).toHaveBeenCalledOnce()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
