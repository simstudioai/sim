/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReleaseExecutionSlot, mockReplaceLargeValueReferenceKeysWithClient } = vi.hoisted(
  () => ({
    mockReleaseExecutionSlot: vi.fn(),
    mockReplaceLargeValueReferenceKeysWithClient: vi.fn(),
  })
)

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  collectLargeValueReferenceKeys: vi.fn(() => []),
  replaceLargeValueReferenceKeysWithClient: mockReplaceLargeValueReferenceKeysWithClient,
}))

import {
  PauseResumeManager,
  updateResumeOutputInAggregationBuffers,
} from '@/lib/workflows/executor/human-in-the-loop-manager'
import { AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH } from '@/lib/workflows/executor/resume-policy'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { PausePoint, SerializedSnapshot } from '@/executor/types'

function createBillingAttribution(extra: Record<string, unknown> = {}) {
  return {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user', id: 'user-1' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
    ...extra,
  }
}

function createSnapshotSeed(
  billingAttribution: Record<string, unknown> = createBillingAttribution()
): SerializedSnapshot {
  return {
    snapshot: JSON.stringify({
      metadata: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        billingAttribution,
      },
      durableState: 'retained',
    }),
    triggerIds: [],
  }
}

function createExecutionState(): SerializableExecutionState {
  return {
    blockStates: {},
    executedBlocks: [],
    blockLogs: [],
    decisions: { router: {}, condition: {} },
    completedLoops: [],
    activeExecutionPath: [],
  }
}

describe('updateResumeOutputInAggregationBuffers', () => {
  it('replaces a paused parallel branch placeholder with the resumed HITL output', () => {
    const pausedOutput = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'pause-context-1',
        blockId: 'hitl₍1₎',
      },
    }
    const siblingOutput = { value: 'already-complete' }
    const mergedOutput = {
      response: { data: { submission: { approved: true } } },
      submission: { approved: true },
      _resumed: true,
    }
    const state = createExecutionState()
    state.parallelExecutions = {
      'parallel-1': {
        branchOutputs: {
          0: [siblingOutput],
          1: [pausedOutput],
        },
      },
    }

    updateResumeOutputInAggregationBuffers(
      state,
      'hitl₍1₎',
      'hitl',
      'pause-context-1',
      mergedOutput
    )

    expect(state.parallelExecutions['parallel-1'].branchOutputs).toEqual({
      0: [siblingOutput],
      1: [mergedOutput],
    })
  })

  it('does not replace unrelated paused parallel branch outputs', () => {
    const unrelatedPausedOutput = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'different-context',
        blockId: 'hitl₍1₎',
      },
    }
    const mergedOutput = {
      response: { data: { submission: { approved: true } } },
      submission: { approved: true },
      _resumed: true,
    }
    const state = createExecutionState()
    state.parallelExecutions = {
      'parallel-1': {
        branchOutputs: {
          1: [unrelatedPausedOutput],
        },
      },
    }

    updateResumeOutputInAggregationBuffers(
      state,
      'hitl₍1₎',
      'hitl',
      'pause-context-1',
      mergedOutput
    )

    expect(state.parallelExecutions['parallel-1'].branchOutputs).toEqual({
      1: [unrelatedPausedOutput],
    })
  })

  it('replaces paused loop iteration outputs using the resumed state block key', () => {
    const pausedOutput = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'pause-context-1',
        blockId: 'hitl',
      },
    }
    const unrelatedPausedOutput = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'different-context',
        blockId: 'hitl',
      },
    }
    const siblingOutput = { value: 'already-complete' }
    const mergedOutput = {
      response: { data: { submission: { approved: true } } },
      submission: { approved: true },
      _resumed: true,
    }
    const state = createExecutionState()
    state.loopExecutions = {
      'loop-1': {
        currentIterationOutputs: {
          hitl: pausedOutput,
          sibling: siblingOutput,
        },
      },
      'loop-2': {
        currentIterationOutputs: {
          hitl: unrelatedPausedOutput,
        },
      },
    }

    updateResumeOutputInAggregationBuffers(
      state,
      'hitl₍1₎',
      'hitl',
      'pause-context-1',
      mergedOutput
    )

    expect(state.loopExecutions['loop-1'].currentIterationOutputs).toEqual({
      'hitl₍1₎': mergedOutput,
      sibling: siblingOutput,
    })
    expect(state.loopExecutions['loop-2'].currentIterationOutputs).toEqual({
      hitl: unrelatedPausedOutput,
    })
  })
})

describe('PauseResumeManager.getPauseContextDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('does not duplicate a pause point large response payload between pausePoint and execution.pausePoints', async () => {
    const largeDisplayValue = 'x'.repeat(50_000)

    const row = {
      id: 'paused-exec-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      status: 'paused',
      pausedAt: null,
      updatedAt: null,
      expiresAt: null,
      metadata: {},
      executionSnapshot: { triggerIds: [] },
      pausePoints: {
        'ctx-1': {
          contextId: 'ctx-1',
          blockId: 'hitl-1',
          resumeStatus: 'paused',
          automaticResumeWaitingReason: 'Usage admission unavailable',
          snapshotReady: true,
          pauseKind: 'human',
          registeredAt: '2026-07-02T00:00:00.000Z',
          response: {
            data: {
              operation: 'human',
              inputFormat: [{ id: 'field_0', name: 'approved', type: 'boolean', required: false }],
              submission: null,
              responseStructure: [
                { name: 'ai_analysis', type: 'string', value: largeDisplayValue },
              ],
            },
            status: 200,
            headers: {},
          },
        },
        'ctx-2': {
          contextId: 'ctx-2',
          blockId: 'hitl-2',
          resumeStatus: 'paused',
          snapshotReady: true,
          pauseKind: 'human',
          registeredAt: '2026-07-02T00:00:00.000Z',
          response: {
            data: { operation: 'human', inputFormat: [], submission: null },
            status: 200,
            headers: {},
          },
        },
      },
    }

    dbChainMockFns.limit.mockResolvedValueOnce([row])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    const detail = await PauseResumeManager.getPauseContextDetail({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      contextId: 'ctx-1',
    })

    expect(detail).not.toBeNull()
    // The requested pause point keeps its full response payload.
    expect(detail!.pausePoint.response.data.responseStructure[0].value).toBe(largeDisplayValue)
    expect(detail!.pausePoint.contextId).toBe('ctx-1')
    expect(detail!.pausePoint.automaticResumeWaitingReason).toBe('Usage admission unavailable')

    // `execution.pausePoints` must not re-embed the (potentially large)
    // response payload — it's already available via `pausePoint` above.
    for (const point of detail!.execution.pausePoints) {
      expect(point.response?.data).toBeUndefined()
    }
    // Non-payload fields are still present on the execution's pause points.
    expect(detail!.execution.pausePoints.map((p) => p.contextId).sort()).toEqual(['ctx-1', 'ctx-2'])
    expect(detail!.execution.pausePoints.find((p) => p.contextId === 'ctx-1')?.resumeStatus).toBe(
      'paused'
    )
    expect(
      detail!.execution.pausePoints.find((p) => p.contextId === 'ctx-1')
        ?.automaticResumeWaitingReason
    ).toBe('Usage admission unavailable')
  })

  it('returns null when the pause context no longer exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'paused-exec-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        status: 'paused',
        pausedAt: null,
        updatedAt: null,
        expiresAt: null,
        metadata: {},
        executionSnapshot: { triggerIds: [] },
        pausePoints: {
          'ctx-1': {
            contextId: 'ctx-1',
            blockId: 'hitl-1',
            resumeStatus: 'paused',
            snapshotReady: true,
            pauseKind: 'human',
            registeredAt: '2026-07-02T00:00:00.000Z',
            response: { data: { operation: 'human' }, status: 200, headers: {} },
          },
        },
      },
    ])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    const detail = await PauseResumeManager.getPauseContextDetail({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      contextId: 'missing-ctx',
    })

    expect(detail).toBeNull()
  })
})

describe('PauseResumeManager.persistPauseResult metadata merge on re-pause', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('persists a multi-day re-pause, preserves metadata, then releases its reservation', async () => {
    const cellContext = {
      tableId: 'table-1',
      rowId: 'row-1',
      workspaceId: 'workspace-1',
      groupId: 'group-1',
      workflowId: 'workflow-1',
    }
    const existingRow = {
      id: 'paused-exec-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      status: 'partially_resumed',
      pausePoints: {
        'ctx-wait-1': {
          contextId: 'ctx-wait-1',
          blockId: 'wait1',
          resumeStatus: 'resuming',
          automaticResumeWaitingReason: 'Previous admission wait',
        },
      },
      metadata: {
        pauseScope: 'execution',
        triggerIds: ['start'],
        executorUserId: 'user-1',
        automaticResumeWaiting: {
          contextId: 'ctx-wait-1',
          reason: 'Previous admission wait',
          recordedAt: '2026-07-10T00:00:00.000Z',
        },
        cellContext,
      },
    }

    // First `.limit(1)` resolves the select-for-update to the existing row,
    // forcing persistPauseResult down the update (not insert) branch.
    dbChainMockFns.limit.mockResolvedValueOnce([existingRow])

    const snapshotSeed = createSnapshotSeed()
    const pausePoints: PausePoint[] = [
      {
        contextId: 'ctx-wait-2',
        blockId: 'wait2',
        pauseKind: 'time',
        resumeAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        resumeStatus: 'paused',
      } as PausePoint,
    ]

    await PauseResumeManager.persistPauseResult({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      pausePoints,
      snapshotSeed,
      executorUserId: 'user-1',
    })

    const updateSetCall = dbChainMockFns.set.mock.calls.find(
      ([arg]) => arg && typeof arg === 'object' && 'metadata' in (arg as Record<string, unknown>)
    )
    expect(updateSetCall).toBeDefined()

    const update = updateSetCall![0] as {
      metadata: Record<string, unknown>
      pausePoints: Record<string, Record<string, unknown>>
    }
    const updatedMetadata = update.metadata
    expect(updatedMetadata.cellContext).toEqual(cellContext)
    expect(updatedMetadata.pauseScope).toBe('execution')
    expect(updatedMetadata.executorUserId).toBe('user-1')
    expect(updatedMetadata.workspaceId).toBe('workspace-1')
    expect(updatedMetadata.billingAttribution).toEqual(createBillingAttribution())
    expect(updatedMetadata).not.toHaveProperty('automaticResumeWaiting')
    expect(update.pausePoints['ctx-wait-1']).toEqual(
      expect.objectContaining({ resumeStatus: 'resumed' })
    )
    expect(update.pausePoints['ctx-wait-1']).not.toHaveProperty('automaticResumeWaitingReason')
    expect(mockReleaseExecutionSlot).toHaveBeenCalledTimes(1)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('stores only canonical bounded resume metadata while retaining the full snapshot', async () => {
    const oversizedValue = 'x'.repeat(50_000)
    const snapshotSeed = createSnapshotSeed(
      createBillingAttribution({
        ignoredOversizedField: oversizedValue,
        billingEntity: {
          type: 'user',
          id: 'user-1',
          ignoredOversizedField: oversizedValue,
        },
      })
    )
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await PauseResumeManager.persistPauseResult({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      pausePoints: [
        {
          contextId: 'ctx-wait-1',
          blockId: 'wait-1',
          pauseKind: 'time',
          resumeAt: '2026-07-11T00:00:00.000Z',
          resumeStatus: 'paused',
        } as PausePoint,
      ],
      snapshotSeed,
      executorUserId: 'user-1',
    })

    const insert = dbChainMockFns.values.mock.calls.find(
      ([value]) =>
        value &&
        typeof value === 'object' &&
        'executionSnapshot' in (value as Record<string, unknown>)
    )?.[0] as
      | {
          executionSnapshot: SerializedSnapshot
          metadata: Record<string, unknown>
        }
      | undefined

    expect(insert?.executionSnapshot).toBe(snapshotSeed)
    expect(insert?.metadata).toEqual({
      pauseScope: 'execution',
      triggerIds: [],
      executorUserId: 'user-1',
      workspaceId: 'workspace-1',
      billingAttribution: createBillingAttribution(),
    })
    expect(JSON.stringify(insert?.metadata)).not.toContain(oversizedValue)
  })

  it('rejects pause metadata whose workspace and attribution do not match', async () => {
    await expect(
      PauseResumeManager.persistPauseResult({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        pausePoints: [],
        snapshotSeed: createSnapshotSeed(
          createBillingAttribution({ workspaceId: 'different-workspace' })
        ),
        executorUserId: 'user-1',
      })
    ).rejects.toThrow('Paused execution workspace does not match its billing attribution')

    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})

describe('PauseResumeManager paused cancellation after pause release', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('does not release again when an idle paused execution is abandoned', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'paused' }])
      .mockResolvedValueOnce([])

    await expect(
      PauseResumeManager.beginPausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('does not release again when staged cancellation becomes terminal', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'paused' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'cancelling' }])

    await expect(
      PauseResumeManager.beginPausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('does not release again when cancellation is already terminal', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'cancelled' }])

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('does not release an active resume from the paused cancellation path', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'paused' }])
      .mockResolvedValueOnce([{ id: 'resume-1' }])

    await expect(
      PauseResumeManager.beginPausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(false)

    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })
})

describe('PauseResumeManager blocked resume readmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('keeps the queued input pending without incrementing resumed state', async () => {
    const failureReason = 'Usage admission unavailable '.repeat(100)
    const startedAt = Date.now()

    await PauseResumeManager.markResumeAttemptFailed({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
      failureReason,
      preserveForRetry: true,
    })

    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      status: 'pending',
      failureReason,
      claimedAt: null,
      completedAt: null,
    })
    const pausedUpdate = dbChainMockFns.set.mock.calls[1]?.[0] as {
      nextResumeAt: Date
      pausePoints: unknown
      metadata: unknown
    }
    expect(pausedUpdate).toEqual(expect.objectContaining({ nextResumeAt: expect.any(Date) }))
    expect(pausedUpdate.nextResumeAt.getTime() - startedAt).toBeGreaterThanOrEqual(59_000)
    expect(pausedUpdate.nextResumeAt.getTime() - startedAt).toBeLessThanOrEqual(61_000)
    const persistedWaitingState = JSON.stringify({
      pausePoints: pausedUpdate.pausePoints,
      metadata: pausedUpdate.metadata,
    })
    expect(persistedWaitingState).toContain('Usage admission unavailable')
    expect(persistedWaitingState).not.toContain(
      failureReason.slice(0, AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH + 1)
    )
    expect(
      dbChainMockFns.set.mock.calls.some(
        ([value]) =>
          value && typeof value === 'object' && ('resumedCount' in value || 'resumeInput' in value)
      )
    ).toBe(false)
  })

  it('stores a bounded automatic waiting reason with the requested retry time', async () => {
    const reason = 'Temporary admission outage '.repeat(100)
    const retryAt = new Date('2026-07-10T12:01:00.000Z')

    await PauseResumeManager.setAutomaticResumeWaiting({
      pausedExecutionId: 'paused-exec-1',
      contextId: 'context-1',
      reason,
      retryAt,
    })

    const update = dbChainMockFns.set.mock.calls[0]?.[0] as {
      nextResumeAt: Date
      pausePoints: unknown
      metadata: unknown
    }
    expect(update.nextResumeAt).toBe(retryAt)
    const serializedWaitingState = JSON.stringify({
      pausePoints: update.pausePoints,
      metadata: update.metadata,
    })
    expect(serializedWaitingState).toContain('Temporary admission outage')
    expect(serializedWaitingState).not.toContain(
      reason.slice(0, AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH + 1)
    )
  })
})
