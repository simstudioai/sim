/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_DURABLE_LARGE_VALUE_BYTES,
  MAX_TRACE_ARCHIVE_BYTES,
} from '@/lib/execution/payloads/limits'

const {
  mockPrimaryRead,
  mockRead,
  mockInfo,
  mockDataRead,
  mockTransaction,
  mockUpdate,
  mockExternalize,
  mockReplaceReferences,
} = vi.hoisted(() => ({
  mockPrimaryRead: vi.fn(),
  mockRead: vi.fn(),
  mockInfo: vi.fn(),
  mockDataRead: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdate: vi.fn(),
  mockExternalize: vi.fn(),
  mockReplaceReferences: vi.fn(),
}))

vi.mock('@sim/db', () => {
  const execDb = {
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
  return {
    db: { select: () => ({ from: () => ({ limit: mockPrimaryRead }) }) },
    dbFor: (role: string) => {
      if (role !== 'exec') throw new Error(`Unexpected database role: ${role}`)
      return execDb
    },
  }
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
  mockPrimaryRead.mockImplementation((limit: number) => {
    if (limit !== 0) throw new Error('Execution payloads must use the execution pool')
    return Promise.resolve([])
  })
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
    const before = '2026-09-17T20:00:00.000Z'
    vi.useFakeTimers({ now: new Date(before) })
    expect(parseArgs([])).toEqual({
      maxBatches: Number.POSITIVE_INFINITY,
      concurrency: 4,
      maxInFlightMiB: 512,
      checkOnly: false,
      order: 'oldest',
      before,
    })
    expect(parseArgs(['--check-only', '--max-batches=2', '--concurrency=8'])).toEqual({
      maxBatches: 2,
      concurrency: 8,
      maxInFlightMiB: 512,
      checkOnly: true,
      order: 'oldest',
      before,
    })
  })

  it.each([50, 64, 200, 500, 512])('supports %i workers', (concurrency) => {
    expect(parseArgs([`--concurrency=${concurrency}`]).concurrency).toBe(concurrency)
  })

  it('supports a bounded payload budget independently of worker count', () => {
    expect(parseArgs(['--concurrency=500', '--max-in-flight-mib=128'])).toMatchObject({
      concurrency: 500,
      maxInFlightMiB: 128,
    })
  })

  it('preserves microseconds, ordering, and cutoff when resuming a checkpoint', () => {
    const cursor = {
      version: 1,
      order: 'newest',
      before: '2026-01-01T00:00:00.000Z',
      startedAt: '2025-01-01T00:00:00.123456Z',
      id: 'log-1',
    }
    const flag = `--cursor=${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`
    expect(parseArgs([flag])).toMatchObject({ cursor, order: cursor.order, before: cursor.before })
    expect(() => parseArgs([flag, '--order=oldest'])).toThrow('must match')
    expect(() => parseArgs([flag, '--before=2026-02-01T00:00:00.000Z'])).toThrow('must match')
    expect(() => parseArgs(['--cursor=invalid'])).toThrow('Invalid --cursor')
  })

  it.each([
    '--max-batches=2junk',
    '--max-batches=1.5',
    '--max-batches=0',
    '--concurrency=513',
    '--max-in-flight-mib=63',
    '--max-in-flight-mib=4097',
    '--max-in-flight-mib=1.5',
    '--concurrency=-1',
    '--concurrency=0',
    '--concurrency=2=3',
    '--unknown',
  ])('rejects invalid input: %s', (arg) => {
    expect(() => parseArgs([arg])).toThrow()
  })
})

describe('backfill workers', () => {
  it('reserves bytes before starting work and releases capacity for subsequent rows', async () => {
    const rows = [6, 6, 4, 9, 1]
    let activeBytes = 0
    let peakBytes = 0
    const visited: number[] = []
    const completed = await runBackfillWorkers(
      rows,
      5,
      async (bytes) => {
        activeBytes += bytes
        peakBytes = Math.max(peakBytes, activeBytes)
        visited.push(bytes)
        await Promise.resolve()
        activeBytes -= bytes
      },
      { byteBudget: { maxBytes: 10, sizeOf: (bytes) => bytes } }
    )
    expect(completed).toBe(5)
    expect(peakBytes).toBe(10)
    expect(visited).toEqual(rows)
  })

  it('rejects a row larger than the byte budget without starting it', async () => {
    const processRow = vi.fn()
    await expect(
      runBackfillWorkers([11], 5, processRow, {
        byteBudget: { maxBytes: 10, sizeOf: (bytes) => bytes },
      })
    ).rejects.toThrow('byte budget')
    expect(processRow).not.toHaveBeenCalled()
  })

  it('stops scheduling on shutdown while allowing started writes to settle', async () => {
    const controller = new AbortController()
    const finished: number[] = []
    const completed = await runBackfillWorkers(
      [1, 2, 3, 4],
      2,
      async (id) => {
        controller.abort()
        await Promise.resolve()
        finished.push(id)
      },
      { signal: controller.signal }
    )
    expect(completed).toBe(2)
    expect(finished).toEqual([1, 2])
  })

  it.each([2, 50, 64, 500])(
    'bounds active work to %i workers and visits every candidate once',
    async (concurrency) => {
      let active = 0
      let peak = 0
      const visited: string[] = []
      const rows = Array.from({ length: 1030 }, (_, index) => ({
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
  const options = {
    maxBatches: 1,
    concurrency: 1,
    maxInFlightMiB: 512,
    checkOnly: false,
    order: 'oldest' as const,
    before: '2026-09-17T20:00:00.000Z',
  }
  const candidate = {
    id: 'log-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    workflowOwnerUserId: 'user-1',
    payloadBytes: 128,
    executionData: { traceSpans: [{ children: [{}] }] },
  }
  const candidateMetadata = { id: candidate.id, startedAt: '2026-09-16T20:00:00.123456Z' }

  it('fails its schema check before uploading anything and preserves the database cause', async () => {
    const cause = new Error('column "size_bytes" does not exist')
    const error = new Error('Failed query', { cause })
    mockPrimaryRead.mockRejectedValueOnce(error)
    await expect(backfillTraceStorage(options)).rejects.toBe(error)
    expect(mockDataRead).not.toHaveBeenCalled()
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('check-only performs no uploads, writes, or payload reads', async () => {
    await backfillTraceStorage({ ...options, checkOnly: true })
    expect(mockPrimaryRead).toHaveBeenCalledExactlyOnceWith(0)
    expect(mockRead).toHaveBeenCalledTimes(4)
    expect(mockRead.mock.calls.every(([limit]) => limit === 0)).toBe(true)
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('reads and commits logs and references through the execution pool with the workflow owner', async () => {
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([candidate])
    await expect(backfillTraceStorage(options)).resolves.toEqual({
      migrated: 1,
    })
    expect(mockPrimaryRead).toHaveBeenCalledExactlyOnceWith(0)
    expect(mockRead).toHaveBeenCalledTimes(7)
    expect(mockDataRead).toHaveBeenCalledTimes(3)
    expect(mockTransaction).toHaveBeenCalledOnce()
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

  it.each(['execution-user', 'deleted-user', ''])(
    'uses the workflow owner while preserving execution user %j in the payload',
    async (userId) => {
      const executionData = {
        ...structuredClone(candidate.executionData),
        environment: { userId },
      }
      mockDataRead
        .mockResolvedValueOnce([candidateMetadata])
        .mockResolvedValueOnce([candidate])
        .mockResolvedValueOnce([{ ...candidate, executionData }])

      await backfillTraceStorage(options)

      expect(mockExternalize).toHaveBeenCalledWith(
        expect.objectContaining({ environment: { userId } }),
        expect.objectContaining({ userId: candidate.workflowOwnerUserId }),
        { throwOnError: true }
      )
      expect(executionData.environment.userId).toBe(userId)
      expect(mockUpdate).toHaveBeenCalledOnce()
    }
  )

  it('fails before uploading when the workflow owner is missing', async () => {
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([{ ...candidate, workflowOwnerUserId: '' }])

    await expect(backfillTraceStorage(options)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Workflow owner is missing' }),
    })
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects an oversized payload before uploading or updating the log', async () => {
    mockDataRead.mockResolvedValueOnce([candidateMetadata]).mockResolvedValueOnce([
      {
        ...candidate,
        executionData: null,
        payloadBytes: MAX_TRACE_ARCHIVE_BYTES + 1,
      },
    ])
    await expect(backfillTraceStorage(options)).rejects.toThrow('trace archive limit')
    expect(mockDataRead).toHaveBeenCalledTimes(2)
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it.each([MAX_DURABLE_LARGE_VALUE_BYTES + 1, MAX_TRACE_ARCHIVE_BYTES])(
    'uploads and commits a %i-byte archive without skipping it',
    async (payloadBytes) => {
      const large = { ...candidate, payloadBytes }
      mockDataRead
        .mockResolvedValueOnce([candidateMetadata])
        .mockResolvedValueOnce([large])
        .mockResolvedValueOnce([large])

      await expect(backfillTraceStorage(options)).resolves.toEqual({ migrated: 1 })
      expect(mockExternalize).toHaveBeenCalledOnce()
      expect(mockUpdate).toHaveBeenCalledOnce()
      expect(mockReplaceReferences).toHaveBeenCalledOnce()
      expect(mockInfo).toHaveBeenCalledWith(
        'Backfill checkpoint',
        expect.objectContaining(candidateMetadata)
      )
    }
  )

  it('requires enough byte budget before fetching a larger archive and preserves the checkpoint', async () => {
    const cursor = {
      version: 1 as const,
      order: options.order,
      before: options.before,
      startedAt: '2025-01-01T00:00:00.123456Z',
      id: 'previous-log',
    }
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata])
      .mockResolvedValueOnce([
        { id: candidate.id, payloadBytes: MAX_DURABLE_LARGE_VALUE_BYTES + 1 },
      ])

    await expect(backfillTraceStorage({ ...options, maxInFlightMiB: 64, cursor })).rejects.toThrow(
      'increase the byte budget'
    )
    expect(mockDataRead).toHaveBeenCalledTimes(2)
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
    const checkpoints = mockInfo.mock.calls.filter(([message]) => message === 'Backfill checkpoint')
    expect(checkpoints.length).toBeGreaterThan(0)
    expect(checkpoints.every(([, value]) => value.id === cursor.id)).toBe(true)
  })

  it('fails before uploading when the payload grows past its reserved capacity', async () => {
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([
        { ...candidate, payloadBytes: candidate.payloadBytes + 1, executionData: null },
      ])
    await expect(backfillTraceStorage(options)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('grew') }),
    })
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('preserves the previous checkpoint after shutdown interrupts a page', async () => {
    const controller = new AbortController()
    const cursor = {
      version: 1 as const,
      order: options.order,
      before: options.before,
      startedAt: '2025-01-01T00:00:00.123456Z',
      id: 'previous-log',
    }
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata, { ...candidateMetadata, id: 'log-2' }])
      .mockResolvedValueOnce([candidate, { ...candidate, id: 'log-2' }])
      .mockResolvedValueOnce([candidate])
    mockExternalize.mockImplementationOnce(async () => {
      controller.abort()
      return { traceStoreRef: { key: 'stored-key' } }
    })
    await expect(backfillTraceStorage({ ...options, cursor }, controller.signal)).resolves.toEqual({
      migrated: 1,
    })
    expect(mockUpdate).toHaveBeenCalledOnce()
    const checkpoints = mockInfo.mock.calls.filter(([message]) => message === 'Backfill checkpoint')
    expect(checkpoints.length).toBeGreaterThan(0)
    for (const [, checkpoint] of checkpoints) {
      expect(JSON.parse(Buffer.from(checkpoint.cursor, 'base64url').toString('utf8'))).toEqual(
        cursor
      )
    }
  })

  it('advances the cursor over pages with no eligible payloads', async () => {
    mockDataRead.mockResolvedValueOnce([candidateMetadata]).mockResolvedValueOnce([])
    await backfillTraceStorage(options)
    expect(mockExternalize).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith(
      'Backfill checkpoint',
      expect.objectContaining({
        id: candidateMetadata.id,
        startedAt: candidateMetadata.startedAt,
      })
    )
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
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([candidate])
    mockExternalize.mockImplementation(async () => {
      markStarted()
      await upload
      return { traceStoreRef: { key: 'stored-key' } }
    })
    const run = backfillTraceStorage(options)
    await started
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockInfo).toHaveBeenCalledWith(
      'Progress: migrated 0 | skipped 0 | 0.0 rows/s | elapsed 5s',
      expect.objectContaining({ rssMiB: expect.any(Number) })
    )
    finishUpload()
    await run
    expect(mockInfo).toHaveBeenCalledWith(
      'Progress: migrated 1 | skipped 0 | 0.2 rows/s | elapsed 5s',
      expect.objectContaining({
        stages: expect.objectContaining({ externalize: { calls: 1, averageMs: 5000 } }),
      })
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts migrating after preflight without a full-table count or estimate', async () => {
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata])
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([candidate])
    await backfillTraceStorage(options)
    expect(mockRead.mock.calls.map(([limit]) => limit)).toEqual([0, 0, 0, 0, 100, 1, 1])
    expect(mockExternalize).toHaveBeenCalledOnce()
  })

  it('keeps the candidate page at 100 rows with fifty workers', async () => {
    await backfillTraceStorage({ ...options, concurrency: 50 })
    expect(mockRead.mock.calls.map(([limit]) => limit)).toEqual([0, 0, 0, 0, 100])
    expect(mockExternalize).not.toHaveBeenCalled()
  })

  it('scales the bounded metadata page to feed higher concurrency', async () => {
    await backfillTraceStorage({ ...options, concurrency: 500 })
    expect(mockRead.mock.calls.map(([limit]) => limit)).toEqual([0, 0, 0, 0, 1000])
  })

  it('does not update the log or start the next candidate after storage fails', async () => {
    mockDataRead
      .mockResolvedValueOnce([candidateMetadata, { ...candidateMetadata, id: 'log-2' }])
      .mockResolvedValueOnce([candidate, { ...candidate, id: 'log-2' }])
      .mockResolvedValueOnce([candidate])
    const error = new Error('storage denied')
    mockExternalize.mockRejectedValueOnce(error)
    await expect(backfillTraceStorage(options)).rejects.toMatchObject({ cause: error })
    expect(mockExternalize).toHaveBeenCalledOnce()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
