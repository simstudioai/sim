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
