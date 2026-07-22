/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireLockMock,
  assertBillingAttributionSnapshotMock,
  dueRowsLimitMock,
  enqueueOrStartResumeMock,
  executionSnapshotFromJsonMock,
  fallbackRowsLimitMock,
  inArrayMock,
  legacySizeRowsLimitMock,
  lteMock,
  preprocessExecutionMock,
  processQueuedResumesMock,
  releaseLockMock,
  setAutomaticResumeWaitingMock,
  setNextResumeAtMock,
  sqlMock,
} = vi.hoisted(() => ({
  acquireLockMock: vi.fn(),
  assertBillingAttributionSnapshotMock: vi.fn((value: unknown) => value),
  dueRowsLimitMock: vi.fn(),
  enqueueOrStartResumeMock: vi.fn(),
  executionSnapshotFromJsonMock: vi.fn(),
  fallbackRowsLimitMock: vi.fn(),
  inArrayMock: vi.fn(),
  legacySizeRowsLimitMock: vi.fn(),
  lteMock: vi.fn(),
  preprocessExecutionMock: vi.fn(),
  processQueuedResumesMock: vi.fn(),
  releaseLockMock: vi.fn(),
  setAutomaticResumeWaitingMock: vi.fn(),
  setNextResumeAtMock: vi.fn(),
  sqlMock: vi.fn((strings: TemplateStringsArray) =>
    strings.join('').includes('jsonb_build_object') ? 'boundedMetadata' : 'snapshotBytes'
  ),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/db/schema', () => ({
  pausedExecutions: {
    id: 'id',
    executionId: 'executionId',
    workflowId: 'workflowId',
    pausePoints: 'pausePoints',
    metadata: 'metadata',
    executionSnapshot: 'executionSnapshot',
    status: 'status',
    nextResumeAt: 'nextResumeAt',
    automaticResumeRetryCount: 'automaticResumeRetryCount',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  inArray: inArrayMock,
  isNotNull: vi.fn(),
  lte: lteMock,
  sql: sqlMock,
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: vi.fn(() => null),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: assertBillingAttributionSnapshotMock,
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: acquireLockMock,
  releaseLock: releaseLockMock,
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: preprocessExecutionMock,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  computeEarliestResumeAt: vi.fn(() => null),
  PauseResumeManager: {
    enqueueOrStartResume: enqueueOrStartResumeMock,
    processQueuedResumes: processQueuedResumesMock,
    setAutomaticResumeWaiting: setAutomaticResumeWaitingMock,
    setNextResumeAt: setNextResumeAtMock,
  },
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: {
    fromJSON: executionSnapshotFromJsonMock,
  },
}))

import {
  LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE,
  MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES,
} from '@/lib/workflows/executor/paused-execution-policy'
import { GET } from '@/app/api/resume/poll/route'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/resume/poll')
}

function makeBillingAttribution(workspaceId: string, actorUserId: string) {
  return {
    actorUserId,
    workspaceId,
    organizationId: null,
    billedAccountUserId: actorUserId,
    billingEntity: { type: 'user', id: actorUserId },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
  }
}

function makeResumeMetadata(index: number) {
  const workspaceId = `workspace-${index}`
  const executorUserId = `actor-${index}`
  return {
    executorUserId,
    workspaceId,
    billingAttribution: makeBillingAttribution(workspaceId, executorUserId),
  }
}

function makeDueRow(index: number, metadata: unknown = makeResumeMetadata(index)) {
  return {
    id: `paused-${index}`,
    executionId: `execution-${index}`,
    workflowId: `workflow-${index}`,
    automaticResumeRetryCount: 0,
    metadata,
    pausePoints: {
      [`context-${index}`]: {
        contextId: `context-${index}`,
        pauseKind: 'time',
        resumeAt: '2026-07-01T00:00:00.000Z',
        resumeStatus: 'paused',
      },
    },
  }
}

function makeSerializedSnapshot(index: number) {
  return {
    snapshot: JSON.stringify({
      metadata: {
        workspaceId: `workspace-${index}`,
        userId: `actor-${index}`,
        billingAttribution: makeBillingAttribution(`workspace-${index}`, `actor-${index}`),
      },
    }),
    triggerIds: [],
  }
}

describe('time-pause resume admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.select.mockImplementation((selection: Record<string, unknown>) => {
      if ('snapshotBytes' in selection) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: legacySizeRowsLimitMock,
            })),
          })),
        }
      }
      if ('executionSnapshot' in selection) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: fallbackRowsLimitMock,
            })),
          })),
        }
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: dueRowsLimitMock,
            })),
          })),
        })),
      }
    })
    acquireLockMock.mockResolvedValue(true)
    releaseLockMock.mockResolvedValue(undefined)
    dueRowsLimitMock.mockResolvedValue([])
    fallbackRowsLimitMock.mockResolvedValue([])
    legacySizeRowsLimitMock.mockResolvedValue([])
    setAutomaticResumeWaitingMock.mockResolvedValue(undefined)
    setNextResumeAtMock.mockResolvedValue(undefined)
    processQueuedResumesMock.mockResolvedValue(undefined)
    preprocessExecutionMock.mockResolvedValue({ success: true, actorUserId: 'actor-1' })
    enqueueOrStartResumeMock.mockResolvedValue({
      status: 'queued',
      resumeExecutionId: 'execution-1',
      queuePosition: 1,
    })
    executionSnapshotFromJsonMock.mockImplementation((value: string) => JSON.parse(value))
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('keeps a timed pause unclaimed, records why, and schedules automatic retry', async () => {
    dueRowsLimitMock.mockResolvedValueOnce([makeDueRow(1)])
    preprocessExecutionMock.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Usage admission unavailable',
        statusCode: 503,
        retryable: true,
        logCreated: false,
      },
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(preprocessExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        workspaceId: 'workspace-1',
        skipConcurrencyReservation: true,
        logPreprocessingErrors: false,
      })
    )
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
    expect(setAutomaticResumeWaitingMock).toHaveBeenCalledWith({
      pausedExecutionId: 'paused-1',
      contextId: 'context-1',
      reason: 'Usage admission unavailable',
      retryAt: expect.any(Date),
      retryable: true,
    })
    expect(setNextResumeAtMock).not.toHaveBeenCalled()
    expect(legacySizeRowsLimitMock).not.toHaveBeenCalled()
    expect(fallbackRowsLimitMock).not.toHaveBeenCalled()
    expect(executionSnapshotFromJsonMock).not.toHaveBeenCalled()
  })

  it('stops automatic admission immediately for a permanent preflight failure', async () => {
    dueRowsLimitMock.mockResolvedValueOnce([makeDueRow(1)])
    preprocessExecutionMock.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Usage limit requires intervention',
        statusCode: 402,
        retryable: false,
      },
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
    expect(setAutomaticResumeWaitingMock).toHaveBeenCalledOnce()
    expect(setAutomaticResumeWaitingMock).toHaveBeenCalledWith({
      pausedExecutionId: 'paused-1',
      contextId: 'context-1',
      reason: 'Usage limit requires intervention',
      retryAt: null,
      retryable: false,
    })
  })

  it('preprocesses once when one paused row has multiple due time points', async () => {
    const baseRow = makeDueRow(1)
    dueRowsLimitMock.mockResolvedValueOnce([
      {
        ...baseRow,
        pausePoints: {
          ...baseRow.pausePoints,
          'context-2': {
            contextId: 'context-2',
            pauseKind: 'time',
            resumeAt: '2026-07-01T00:00:00.000Z',
            resumeStatus: 'paused',
          },
        },
      },
    ])

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(preprocessExecutionMock).toHaveBeenCalledTimes(1)
    expect(enqueueOrStartResumeMock).toHaveBeenCalledTimes(2)
  })

  it('increments admission retry state once for a paused row with multiple due points', async () => {
    const row = makeDueRow(1)
    row.pausePoints['context-2'] = {
      contextId: 'context-2',
      pauseKind: 'time',
      resumeAt: '2026-07-01T00:00:00.000Z',
      resumeStatus: 'paused',
    }
    dueRowsLimitMock.mockResolvedValueOnce([row])
    preprocessExecutionMock.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Usage admission unavailable',
        statusCode: 503,
        retryable: true,
      },
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(setAutomaticResumeWaitingMock).toHaveBeenCalledOnce()
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
  })

  it('retries a preserved queued input without creating a replacement input', async () => {
    const row = makeDueRow(1)
    row.pausePoints['context-1'] = {
      contextId: 'context-1',
      pauseKind: 'human',
      resumeAt: '2026-07-01T00:00:00.000Z',
      resumeStatus: 'queued',
    }
    dueRowsLimitMock.mockResolvedValueOnce([row])

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(processQueuedResumesMock).toHaveBeenCalledWith('execution-1', 'workflow-1')
    expect(preprocessExecutionMock).not.toHaveBeenCalled()
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
  })

  it('does not clear the retry deadline while a queued resume is already running', async () => {
    const row = makeDueRow(1)
    row.pausePoints['context-1'].resumeStatus = 'resuming'
    dueRowsLimitMock.mockResolvedValueOnce([row])

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(processQueuedResumesMock).toHaveBeenCalledWith('execution-1', 'workflow-1')
    expect(setNextResumeAtMock).not.toHaveBeenCalled()
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
  })

  it('loads and parses snapshots only for legacy rows with missing or invalid metadata', async () => {
    dueRowsLimitMock.mockResolvedValueOnce([
      makeDueRow(1),
      makeDueRow(2, { executorUserId: 'actor-2' }),
      makeDueRow(3, {
        ...makeResumeMetadata(3),
        billingAttribution: makeBillingAttribution('different-workspace', 'actor-3'),
      }),
    ])
    legacySizeRowsLimitMock.mockResolvedValueOnce([
      { id: 'paused-2', snapshotBytes: 1024 },
      { id: 'paused-3', snapshotBytes: 2048 },
    ])
    fallbackRowsLimitMock.mockResolvedValueOnce([
      { id: 'paused-2', executionSnapshot: makeSerializedSnapshot(2) },
      { id: 'paused-3', executionSnapshot: makeSerializedSnapshot(3) },
    ])

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(dueRowsLimitMock).toHaveBeenCalledWith(200)
    expect(legacySizeRowsLimitMock).toHaveBeenCalledWith(200)
    expect(fallbackRowsLimitMock).toHaveBeenCalledWith(LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE)
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.select.mock.calls[0]?.[0]).not.toHaveProperty('executionSnapshot')
    expect(dbChainMockFns.select.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ metadata: 'boundedMetadata' })
    )
    expect(dbChainMockFns.select.mock.calls[1]?.[0]).toHaveProperty('snapshotBytes')
    expect(dbChainMockFns.select.mock.calls[1]?.[0]).not.toHaveProperty('executionSnapshot')
    expect(dbChainMockFns.select.mock.calls[2]?.[0]).toHaveProperty('executionSnapshot')
    expect(
      sqlMock.mock.calls.some(([strings]) =>
        (strings as TemplateStringsArray).join('').includes('octet_length(')
      )
    ).toBe(true)
    expect(
      inArrayMock.mock.calls.some(
        ([column, values]) =>
          column === 'id' && Array.isArray(values) && values.join(',') === 'paused-2,paused-3'
      )
    ).toBe(true)
    expect(executionSnapshotFromJsonMock).toHaveBeenCalledTimes(2)
    expect(preprocessExecutionMock).toHaveBeenCalledTimes(3)
  })

  it('keeps an unreadable legacy row paused with a visible retry reason', async () => {
    dueRowsLimitMock.mockResolvedValueOnce([makeDueRow(1, { executorUserId: 'actor-1' })])
    legacySizeRowsLimitMock.mockResolvedValueOnce([{ id: 'paused-1', snapshotBytes: 1024 }])
    fallbackRowsLimitMock.mockResolvedValueOnce([
      {
        id: 'paused-1',
        executionSnapshot: { snapshot: '{invalid', triggerIds: [] },
      },
    ])
    executionSnapshotFromJsonMock.mockImplementationOnce(() => {
      throw new Error('Snapshot JSON is invalid')
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(preprocessExecutionMock).not.toHaveBeenCalled()
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
    expect(setAutomaticResumeWaitingMock).toHaveBeenCalledWith({
      pausedExecutionId: 'paused-1',
      contextId: 'context-1',
      reason: 'Snapshot JSON is invalid',
      retryAt: null,
      retryable: false,
    })
  })

  it('never selects or deserializes an oversized legacy snapshot', async () => {
    const oversizedRow = makeDueRow(1, { executorUserId: 'actor-1' })
    oversizedRow.pausePoints['context-1'].resumeStatus = 'queued'
    dueRowsLimitMock.mockResolvedValue([oversizedRow])
    legacySizeRowsLimitMock.mockResolvedValue([
      {
        id: 'paused-1',
        snapshotBytes: MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES + 1,
      },
    ])

    const firstResponse = await GET(makeRequest())
    const secondResponse = await GET(makeRequest())

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(legacySizeRowsLimitMock).toHaveBeenCalledTimes(2)
    expect(legacySizeRowsLimitMock).toHaveBeenNthCalledWith(1, 200)
    expect(legacySizeRowsLimitMock).toHaveBeenNthCalledWith(2, 200)
    expect(fallbackRowsLimitMock).not.toHaveBeenCalled()
    expect(
      dbChainMockFns.select.mock.calls.some(([selection]) => 'executionSnapshot' in selection)
    ).toBe(false)
    expect(executionSnapshotFromJsonMock).not.toHaveBeenCalled()
    expect(preprocessExecutionMock).not.toHaveBeenCalled()
    expect(enqueueOrStartResumeMock).not.toHaveBeenCalled()
    expect(processQueuedResumesMock).not.toHaveBeenCalled()
    expect(setAutomaticResumeWaitingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pausedExecutionId: 'paused-1',
        contextId: 'context-1',
        reason: expect.stringContaining('16 MiB automatic-resume safety limit'),
        retryAt: null,
        retryable: false,
      })
    )
  })

  it('preserves due-row order when concurrent admission checks finish out of order', async () => {
    dueRowsLimitMock.mockResolvedValueOnce([makeDueRow(1), makeDueRow(2)])
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    preprocessExecutionMock.mockImplementation(async ({ executionId }: { executionId: string }) => {
      if (executionId === 'execution-1') {
        await firstGate
      }
      return {
        success: false,
        error: {
          message: `Blocked ${executionId}`,
          statusCode: 503,
          retryable: true,
          logCreated: false,
        },
      }
    })

    const responsePromise = GET(makeRequest())
    await vi.waitFor(() => {
      expect(preprocessExecutionMock).toHaveBeenCalledTimes(2)
    })
    releaseFirst?.()

    const response = await responsePromise
    const payload = (await response.json()) as {
      failures: Array<{ executionId: string }>
    }
    expect(payload.failures.map((failure) => failure.executionId)).toEqual([
      'execution-1',
      'execution-2',
    ])
  })

  it('loads qualifying legacy snapshots in sequential four-row chunks', async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      makeDueRow(index + 1, { executorUserId: `actor-${index + 1}` })
    )
    dueRowsLimitMock.mockResolvedValueOnce(rows)
    legacySizeRowsLimitMock.mockResolvedValueOnce(
      rows.map((row) => ({ id: row.id, snapshotBytes: 1024 }))
    )
    const snapshotChunks = [
      rows.slice(0, 4).map((row, index) => ({
        id: row.id,
        executionSnapshot: makeSerializedSnapshot(index + 1),
      })),
      rows.slice(4, 8).map((row, index) => ({
        id: row.id,
        executionSnapshot: makeSerializedSnapshot(index + 5),
      })),
      rows.slice(8).map((row, index) => ({
        id: row.id,
        executionSnapshot: makeSerializedSnapshot(index + 9),
      })),
    ]
    let activeSnapshotLoads = 0
    let maxActiveSnapshotLoads = 0
    fallbackRowsLimitMock.mockImplementation(async () => {
      const chunk = snapshotChunks[fallbackRowsLimitMock.mock.calls.length - 1] ?? []
      activeSnapshotLoads++
      maxActiveSnapshotLoads = Math.max(maxActiveSnapshotLoads, activeSnapshotLoads)
      await Promise.resolve()
      activeSnapshotLoads--
      return chunk
    })

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(fallbackRowsLimitMock).toHaveBeenCalledTimes(3)
    expect(fallbackRowsLimitMock.mock.calls).toEqual([
      [LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE],
      [LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE],
      [LEGACY_PAUSED_SNAPSHOT_FALLBACK_CHUNK_SIZE],
    ])
    const snapshotIdBatches = inArrayMock.mock.calls
      .filter(([column]) => column === 'id')
      .map(([, ids]) => ids as string[])
    expect(snapshotIdBatches.map((ids) => ids.length)).toEqual([10, 4, 4, 2])
    expect(
      lteMock.mock.calls.filter(
        ([expression, limit]) =>
          expression === 'snapshotBytes' && limit === MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES
      )
    ).toHaveLength(3)
    expect(maxActiveSnapshotLoads).toBe(1)
    expect(executionSnapshotFromJsonMock).toHaveBeenCalledTimes(10)
    expect(preprocessExecutionMock).toHaveBeenCalledTimes(10)
  })

  it('caps preprocessing at ten pipelines while preserving the 200-row batch bound', async () => {
    dueRowsLimitMock.mockResolvedValueOnce(
      Array.from({ length: 200 }, (_, index) => makeDueRow(index + 1))
    )

    let active = 0
    let maxActive = 0
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    preprocessExecutionMock.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await gate
      active--
      return { success: true, actorUserId: 'actor-1' }
    })

    const responsePromise = GET(makeRequest())
    await vi.waitFor(() => {
      expect(preprocessExecutionMock).toHaveBeenCalledTimes(10)
    })

    expect(active).toBe(10)
    expect(maxActive).toBe(10)
    releaseGate?.()

    const response = await responsePromise
    const payload = (await response.json()) as {
      claimedRows: number
      dispatched: number
      failures: unknown[]
    }

    expect(response.status).toBe(200)
    expect(payload).toEqual(
      expect.objectContaining({
        claimedRows: 200,
        dispatched: 200,
        failures: [],
      })
    )
    expect(dueRowsLimitMock).toHaveBeenCalledWith(200)
    expect(preprocessExecutionMock).toHaveBeenCalledTimes(200)
    expect(maxActive).toBe(10)
    expect(legacySizeRowsLimitMock).not.toHaveBeenCalled()
    expect(fallbackRowsLimitMock).not.toHaveBeenCalled()
    expect(executionSnapshotFromJsonMock).not.toHaveBeenCalled()
  })
})
