/**
 * @vitest-environment node
 */
import { pausedExecutions } from '@sim/db/schema'
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTimeoutAbortController, getExecutionDeadlineAt } from '@/lib/core/execution-limits'

const { mockReleaseExecutionSlot, mockReplaceLargeValueReferenceKeysWithClient } = vi.hoisted(
  () => ({
    mockReleaseExecutionSlot: vi.fn(),
    mockReplaceLargeValueReferenceKeysWithClient: vi.fn(),
  })
)

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  collectLargeValueReferenceKeys: vi.fn(() => []),
  replaceLargeValueReferenceKeysWithClient: mockReplaceLargeValueReferenceKeysWithClient,
}))

import {
  createResumeAttemptTimeoutController,
  extractResumeBillingAttributionFromSnapshot,
  PauseResumeManager,
  updateResumeOutputInAggregationBuffers,
} from '@/lib/workflows/executor/human-in-the-loop-manager'
import { getAutomaticResumeWaitingMetadata } from '@/lib/workflows/executor/paused-execution-metadata'
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

describe('queued resume attempt deadlines', () => {
  it('extracts legacy billing metadata without parsing the large snapshot tail', () => {
    const source = JSON.parse(createSnapshotSeed().snapshot) as {
      metadata: Record<string, unknown>
    }
    const snapshot = {
      snapshot: `{"metadata":${JSON.stringify(source.metadata)},"workflow":not-deserialized}`,
      triggerIds: [],
    }

    expect(extractResumeBillingAttributionFromSnapshot(snapshot)).toEqual(
      createBillingAttribution()
    )
  })

  it('admits from persisted resume metadata before reconstructing the full snapshot', () => {
    const billingAttribution = createBillingAttribution()

    const controller = createResumeAttemptTimeoutController(
      { snapshot: 'not-yet-deserialized', triggerIds: [] },
      undefined,
      {
        executorUserId: 'user-1',
        workspaceId: 'workspace-1',
        billingAttribution,
      }
    )

    expect(controller.timeoutMs).toBeTypeOf('number')
    controller.cleanup()
  })

  it('resolves the attempt policy from the immutable payer snapshot before setup', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    const snapshot = createSnapshotSeed(
      createBillingAttribution({
        payerSubscription: {
          id: 'subscription-1',
          referenceId: 'user-1',
          plan: 'enterprise',
          status: 'active',
          seats: 1,
          periodStart: '2026-07-01T00:00:00.000Z',
          periodEnd: '2026-08-01T00:00:00.000Z',
          enterpriseWorkflowExecutionTimeoutSeconds: 7200,
        },
      })
    )

    const controller = createResumeAttemptTimeoutController(snapshot)

    expect(controller.timeoutMs).toBeTypeOf('number')
    if (controller.timeoutMs) {
      expect(getExecutionDeadlineAt(controller.signal)?.getTime()).toBe(
        Date.now() + controller.timeoutMs
      )
    }
    controller.cleanup()
    vi.useRealTimers()
  })

  it('preserves an earlier upstream cancellation deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    const upstream = createTimeoutAbortController(1_000)
    const controller = createResumeAttemptTimeoutController(
      createSnapshotSeed(
        createBillingAttribution({
          payerSubscription: {
            id: 'subscription-1',
            referenceId: 'user-1',
            plan: 'enterprise',
            status: 'active',
            seats: 1,
            periodStart: null,
            periodEnd: null,
            enterpriseWorkflowExecutionTimeoutSeconds: 7200,
          },
        })
      ),
      upstream.signal
    )

    expect(getExecutionDeadlineAt(controller.signal)?.getTime()).toBe(
      getExecutionDeadlineAt(upstream.signal)?.getTime()
    )
    controller.cleanup()
    upstream.cleanup()
    vi.useRealTimers()
  })
})

describe('automatic resume waiting metadata compatibility', () => {
  it('loads legacy waiting metadata with bounded retry defaults', () => {
    expect(
      getAutomaticResumeWaitingMetadata({
        automaticResumeWaiting: {
          contextId: 'context-1',
          reason: 'Temporary admission outage',
          recordedAt: '2026-07-10T12:00:00.000Z',
        },
      })
    ).toEqual({
      contextId: 'context-1',
      reason: 'Temporary admission outage',
      recordedAt: '2026-07-10T12:00:00.000Z',
      state: 'waiting',
      retryCount: 0,
    })
  })
})

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
      reservationId: 'resume-entry-1',
      pausePoints,
      snapshotSeed,
      executorUserId: 'user-1',
    })

    const updateSetCall = dbChainMockFns.set.mock.calls.find(
      ([arg]) => arg && typeof arg === 'object' && 'metadata' in (arg as Record<string, unknown>)
    )
    expect(updateSetCall).toBeDefined()

    const update = updateSetCall![0] as {
      automaticResumeRetryCount: number
      metadata: Record<string, unknown>
      pausePoints: Record<string, Record<string, unknown>>
    }
    expect(update.automaticResumeRetryCount).toBe(0)
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
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('resume-entry-1')
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
    dbChainMockFns.returning.mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(
      PauseResumeManager.beginPausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('scopes paused cancellation to the workflow and preserves a competing terminal status', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'cancelling' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(false)

    expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
      executionDeadlineAt: null,
    })
    const casConditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(casConditions).toContainEqual({
      type: 'eq',
      left: 'executionId',
      right: 'execution-1',
    })
    expect(casConditions).toContainEqual({
      type: 'eq',
      left: 'workflowId',
      right: 'workflow-1',
    })
    expect(casConditions).toContainEqual({
      type: 'inArray',
      column: 'status',
      values: ['running', 'pending', 'cancelled'],
    })
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
    dbChainMockFns.limit.mockResolvedValueOnce([{ automaticResumeRetryCount: 0, status: 'paused' }])

    await PauseResumeManager.markResumeAttemptFailed({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
      failureReason,
      preserveForRetry: true,
      retryable: true,
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
      automaticResumeRetryCount: number
    }
    expect(pausedUpdate).toEqual(expect.objectContaining({ nextResumeAt: expect.any(Date) }))
    expect(pausedUpdate.nextResumeAt.getTime() - startedAt).toBeGreaterThanOrEqual(59_000)
    expect(pausedUpdate.nextResumeAt.getTime() - startedAt).toBeLessThanOrEqual(61_000)
    expect(pausedUpdate.automaticResumeRetryCount).toBe(1)
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

  it('preserves a terminal timeout failure while cleaning up the resume attempt', async () => {
    await PauseResumeManager.markResumeAttemptFailed({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
      failureReason: 'Workflow execution timed out after 5 seconds',
    })

    const logUpdate = dbChainMockFns.set.mock.calls[2]?.[0] as {
      status: { toSQL: () => { sql: string } }
      executionDeadlineAt: Date | null
    }
    expect(logUpdate.status.toSQL().sql).toContain("status IN ('cancelled', 'failed', 'completed')")
    expect(logUpdate.executionDeadlineAt).toBeNull()
  })

  it('stores a bounded automatic waiting reason with the requested retry time', async () => {
    const reason = 'Temporary admission outage '.repeat(100)
    const retryAt = new Date('2026-07-10T12:01:00.000Z')
    dbChainMockFns.limit.mockResolvedValueOnce([{ automaticResumeRetryCount: 0, status: 'paused' }])

    await PauseResumeManager.setAutomaticResumeWaiting({
      pausedExecutionId: 'paused-exec-1',
      contextId: 'context-1',
      reason,
      retryAt,
      retryable: true,
    })

    const update = dbChainMockFns.set.mock.calls[0]?.[0] as {
      nextResumeAt: Date
      pausePoints: unknown
      metadata: unknown
      automaticResumeRetryCount: number
    }
    expect(update.nextResumeAt).toBe(retryAt)
    expect(update.automaticResumeRetryCount).toBe(1)
    const serializedWaitingState = JSON.stringify({
      pausePoints: update.pausePoints,
      metadata: update.metadata,
    })
    expect(serializedWaitingState).toContain('Temporary admission outage')
    expect(serializedWaitingState).not.toContain(
      reason.slice(0, AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH + 1)
    )
  })

  it('fails pending automatic work and restores manual resumability for permanent errors', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ automaticResumeRetryCount: 0, status: 'paused' }])
      .mockResolvedValueOnce([])

    await PauseResumeManager.setAutomaticResumeWaiting({
      pausedExecutionId: 'paused-exec-1',
      contextId: 'context-1',
      reason: 'Usage limit reached',
      retryAt: null,
      retryable: false,
    })

    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: 'failed',
        completedAt: expect.any(Date),
      })
    )
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        automaticResumeRetryCount: 0,
        nextResumeAt: null,
      })
    )
    const pausedUpdate = JSON.stringify(dbChainMockFns.set.mock.calls[1]?.[0])
    expect(pausedUpdate).toContain('intervention_required')
    expect(pausedUpdate).toContain('paused')
  })

  it('fails the queued attempt and leaves the pause manually resumable after exhaustion', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ automaticResumeRetryCount: 3, status: 'paused' }])

    await PauseResumeManager.markResumeAttemptFailed({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
      failureReason: 'Usage admission unavailable',
      preserveForRetry: true,
      retryable: true,
    })

    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: 'failed',
        completedAt: expect.any(Date),
      })
    )
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        automaticResumeRetryCount: 3,
        nextResumeAt: null,
      })
    )
    expect(JSON.stringify(dbChainMockFns.set.mock.calls[1]?.[0])).toContain('intervention_required')
  })
})

describe('PauseResumeManager completed resume transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('clears the active attempt deadline when sibling pause points remain', async () => {
    queueTableRows(pausedExecutions, [{ remaining: 1 }])
    const markResumeCompleted = Reflect.get(PauseResumeManager, 'markResumeCompleted') as (args: {
      resumeEntryId: string
      pausedExecutionId: string
      parentExecutionId: string
      contextId: string
    }) => Promise<void>

    await markResumeCompleted({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
    })

    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(3, {
      status: 'pending',
      executionDeadlineAt: null,
    })
  })
})

describe('PauseResumeManager resume log claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const claimResumeExecutionLog = Reflect.get(
    PauseResumeManager,
    'claimResumeExecutionLog'
  ) as (args: {
    parentExecutionId: string
    workflowId: string
    executionDeadlineAt?: Date
  }) => Promise<void>

  it('atomically stamps the active attempt deadline while claiming a paused log', async () => {
    const executionDeadlineAt = new Date('2026-08-04T12:00:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'log-1' }])

    await claimResumeExecutionLog({
      parentExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      executionDeadlineAt,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'running',
      executionDeadlineAt,
    })
    const statusGuard = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0]).find(
      (condition) => condition.type === 'inArray' && condition.column === 'status'
    )
    expect(statusGuard).toEqual({
      type: 'inArray',
      column: 'status',
      values: ['pending', 'paused'],
    })
  })

  it('rejects a duplicate resume when the log claim CAS loses', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      claimResumeExecutionLog({
        parentExecutionId: 'execution-1',
        workflowId: 'workflow-1',
        executionDeadlineAt: new Date('2026-08-04T13:00:00.000Z'),
      })
    ).rejects.toMatchObject({
      name: 'ResumeAdmissionError',
      message: 'Execution can no longer be resumed',
      statusCode: 409,
      retryable: false,
    })
  })
})
