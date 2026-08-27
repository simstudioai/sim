/**
 * @vitest-environment node
 */
import { pausedExecutions, resumeQueue, workflowExecutionLogs } from '@sim/db/schema'
import {
  dbChainMockFns,
  flattenMockConditions,
  loggerMock,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTimeoutAbortController, getExecutionDeadlineAt } from '@/lib/core/execution-limits'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { terminalExecutionLogFields } from '@/lib/logs/execution/cancellation'

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

const humanInTheLoopLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'HumanInTheLoopManager'
)
const humanInTheLoopLogger =
  loggerMock.createLogger.mock.results[humanInTheLoopLoggerCallIndex]?.value
if (!humanInTheLoopLogger) {
  throw new Error('HumanInTheLoopManager logger mock was not initialized')
}

interface PauseResumeManagerInternals {
  markResumeFailed: (...args: unknown[]) => Promise<void>
  runResumeExecution: (...args: unknown[]) => Promise<unknown>
}

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

describe('resume failure diagnostic projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('rethrows the raw resume error while projecting the internal failure log', async () => {
    const secret = 'hitl-resume-secret-value'
    const message = `Resume execution exposed ${secret} __var_API_KEY __sim_code_1_binding_0`
    const rawError = new Error(message)
    const managerInternals = PauseResumeManager as unknown as PauseResumeManagerInternals
    const runResumeExecutionSpy = vi
      .spyOn(managerInternals, 'runResumeExecution')
      .mockRejectedValueOnce(rawError)
    const markResumeFailedSpy = vi
      .spyOn(managerInternals, 'markResumeFailed')
      .mockResolvedValueOnce()
    const processQueuedResumesSpy = vi
      .spyOn(PauseResumeManager, 'processQueuedResumes')
      .mockResolvedValueOnce()
    type StartResumeArgs = Parameters<typeof PauseResumeManager.startResumeExecution>[0]
    const pausedExecution = {
      id: 'paused-execution-1',
      workflowId: 'workflow-1',
      executionId: 'parent-execution-1',
      pausePoints: {
        'context-1': { contextId: 'context-1', blockId: 'hitl-1' },
      },
      executionSnapshot: createSnapshotSeed(),
      metadata: {},
    } as StartResumeArgs['pausedExecution']

    try {
      await expect(
        PauseResumeManager.startResumeExecution({
          resumeEntryId: 'resume-entry-1',
          resumeExecutionId: 'resume-execution-1',
          pausedExecution,
          contextId: 'context-1',
          resumeInput: { approved: true },
          userId: 'user-1',
        })
      ).rejects.toBe(rawError)

      expect(humanInTheLoopLogger.error).toHaveBeenCalledWith('Resume execution failed', {
        errorType: 'error',
        hasStack: true,
      })
      const loggerPayload = JSON.stringify(humanInTheLoopLogger.error.mock.calls)
      expect(loggerPayload).not.toContain(secret)
      expect(loggerPayload).not.toContain('__var_')
      expect(loggerPayload).not.toContain('__sim_')
      expect(rawError.message).toBe(message)
    } finally {
      runResumeExecutionSpy.mockRestore()
      markResumeFailedSpy.mockRestore()
      processQueuedResumesSpy.mockRestore()
    }
  })

  it('registers and removes the active resume under its exact execution id', async () => {
    const rawError = new Error('resume stopped')
    const managerInternals = PauseResumeManager as unknown as PauseResumeManagerInternals
    const runResumeExecutionSpy = vi
      .spyOn(managerInternals, 'runResumeExecution')
      .mockImplementationOnce(async (...args: unknown[]) => {
        const runArgs = args[0] as { abortSignal: AbortSignal }
        expect(abortManualExecution('parent-execution-1')).toBe(false)
        expect(abortManualExecution('resume-execution-1')).toBe(true)
        expect(runArgs.abortSignal.aborted).toBe(true)
        throw rawError
      })
    const markResumeFailedSpy = vi
      .spyOn(managerInternals, 'markResumeFailed')
      .mockResolvedValueOnce()
    const processQueuedResumesSpy = vi
      .spyOn(PauseResumeManager, 'processQueuedResumes')
      .mockResolvedValueOnce()
    type StartResumeArgs = Parameters<typeof PauseResumeManager.startResumeExecution>[0]
    const pausedExecution = {
      id: 'paused-execution-1',
      workflowId: 'workflow-1',
      executionId: 'parent-execution-1',
      pausePoints: {
        'context-1': { contextId: 'context-1', blockId: 'hitl-1' },
      },
      executionSnapshot: createSnapshotSeed(),
      metadata: {},
    } as StartResumeArgs['pausedExecution']

    try {
      await expect(
        PauseResumeManager.startResumeExecution({
          resumeEntryId: 'resume-entry-1',
          resumeExecutionId: 'resume-execution-1',
          pausedExecution,
          contextId: 'context-1',
          resumeInput: { approved: true },
          userId: 'user-1',
        })
      ).rejects.toBe(rawError)

      expect(abortManualExecution('resume-execution-1')).toBe(false)
    } finally {
      runResumeExecutionSpy.mockRestore()
      markResumeFailedSpy.mockRestore()
      processQueuedResumesSpy.mockRestore()
    }
  })

  it('keeps queued resume dispatch detached while projecting its rejected promise', async () => {
    const secret = 'queued-resume-secret-value'
    const message = `Queued resume exposed ${secret} __var_API_KEY __sim_code_2_binding_0`
    const rawError = new Error(message)
    const pausedExecution = {
      id: 'paused-execution-1',
      workflowId: 'workflow-1',
      executionId: 'parent-execution-1',
      status: 'paused',
      pausePoints: {
        'context-1': {
          contextId: 'context-1',
          blockId: 'hitl-1',
          resumeStatus: 'queued',
        },
      },
      metadata: { executorUserId: 'user-1' },
    }
    const queueEntry = {
      id: 'resume-entry-1',
      pausedExecutionId: pausedExecution.id,
      parentExecutionId: pausedExecution.executionId,
      newExecutionId: 'resume-execution-1',
      contextId: 'context-1',
      resumeInput: { approved: true },
      status: 'pending',
      queuedAt: new Date('2026-08-04T12:00:00.000Z'),
    }
    queueTableRows(pausedExecutions, [pausedExecution])
    queueTableRows(resumeQueue, [])
    queueTableRows(resumeQueue, [queueEntry])
    const startResumeExecutionSpy = vi
      .spyOn(PauseResumeManager, 'startResumeExecution')
      .mockRejectedValueOnce(rawError)

    try {
      await expect(
        PauseResumeManager.processQueuedResumes('parent-execution-1', 'workflow-1')
      ).resolves.toBeUndefined()
      await Promise.resolve()

      expect(humanInTheLoopLogger.error).toHaveBeenCalledWith(
        'Failed to start queued resume execution',
        {
          errorType: 'error',
          hasStack: true,
        }
      )
      const loggerPayload = JSON.stringify(humanInTheLoopLogger.error.mock.calls)
      expect(loggerPayload).not.toContain(secret)
      expect(loggerPayload).not.toContain('__var_')
      expect(loggerPayload).not.toContain('__sim_')
      expect(rawError.message).toBe(message)
    } finally {
      startResumeExecutionSpy.mockRestore()
    }
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
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([existingRow])

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

  it('does not create a resumable pause after cancellation wins the workflow-log lock', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [])
    const processQueuedResumesSpy = vi
      .spyOn(PauseResumeManager, 'processQueuedResumes')
      .mockResolvedValueOnce()

    try {
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
        snapshotSeed: createSnapshotSeed(),
      })

      expect(dbChainMockFns.from).toHaveBeenNthCalledWith(1, workflowExecutionLogs)
      expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, pausedExecutions)
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(processQueuedResumesSpy).not.toHaveBeenCalled()
      expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
    } finally {
      processQueuedResumesSpy.mockRestore()
    }
  })

  it('makes an existing pause terminal when cancellation wins persistence', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'paused' }])
    const processQueuedResumesSpy = vi
      .spyOn(PauseResumeManager, 'processQueuedResumes')
      .mockResolvedValueOnce()

    try {
      await PauseResumeManager.persistPauseResult({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        pausePoints: [],
        snapshotSeed: createSnapshotSeed(),
      })

      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        status: 'cancelled',
        updatedAt: expect.any(Date),
        nextResumeAt: null,
      })
      expect(processQueuedResumesSpy).not.toHaveBeenCalled()
    } finally {
      processQueuedResumesSpy.mockRestore()
    }
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

  it('atomically stages an active resume and returns its exact cancellation target', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'paused' }])
    queueTableRows(resumeQueue, [
      {
        resumeEntryId: 'resume-entry-1',
        pausedExecutionId: 'paused-exec-1',
        parentExecutionId: 'execution-1',
        resumeExecutionId: 'resume-execution-1',
      },
    ])

    await expect(
      PauseResumeManager.stagePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toEqual({
      kind: 'active_resume',
      target: {
        resumeEntryId: 'resume-entry-1',
        pausedExecutionId: 'paused-exec-1',
        parentExecutionId: 'execution-1',
        resumeExecutionId: 'resume-execution-1',
      },
    })

    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(1, workflowExecutionLogs)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, pausedExecutions)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(3, resumeQueue)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      status: 'cancelling',
      updatedAt: expect.any(Date),
    })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      status: 'failed',
      completedAt: expect.any(Date),
      failureReason: 'Paused execution cancellation requested',
    })
  })

  it('stages a stranded active resume for an already-cancelled workflow log', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'partially_resumed' }])
    queueTableRows(resumeQueue, [
      {
        resumeEntryId: 'resume-entry-1',
        pausedExecutionId: 'paused-exec-1',
        parentExecutionId: 'execution-1',
        resumeExecutionId: 'resume-execution-1',
      },
    ])

    await expect(
      PauseResumeManager.stagePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toEqual({
      kind: 'active_resume',
      target: expect.objectContaining({ resumeExecutionId: 'resume-execution-1' }),
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelling' })
    )
  })

  it('stages an idle pause and blocks pending resumes in the same transaction', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'pending' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'partially_resumed' }])
    queueTableRows(resumeQueue, [])

    await expect(
      PauseResumeManager.stagePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toEqual({ kind: 'idle' })

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'failed',
      completedAt: expect.any(Date),
      failureReason: 'Paused execution cancellation requested',
    })
  })

  it('does not stage a pause after the workflow log is terminal', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'completed' }])

    await expect(
      PauseResumeManager.stagePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toEqual({ kind: 'not_paused' })

    expect(dbChainMockFns.from).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('prevents queued resume dispatch from claiming a replacement after staging', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'paused' }])
    queueTableRows(resumeQueue, [])

    await PauseResumeManager.stagePausedCancellation('execution-1', 'workflow-1')
    const resumeQueueReadsAfterStage = dbChainMockFns.from.mock.calls.filter(
      ([table]) => table === resumeQueue
    ).length
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'cancelling' }])
    const startResumeExecutionSpy = vi.spyOn(PauseResumeManager, 'startResumeExecution')

    try {
      await PauseResumeManager.processQueuedResumes('execution-1', 'workflow-1')

      expect(
        dbChainMockFns.from.mock.calls.filter(([table]) => table === resumeQueue)
      ).toHaveLength(resumeQueueReadsAfterStage)
      expect(startResumeExecutionSpy).not.toHaveBeenCalled()
    } finally {
      startResumeExecutionSpy.mockRestore()
    }
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
      .mockResolvedValueOnce([{ status: 'running' }])
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
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'running' }])
      .mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'cancelling' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(false)

    expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
      totalDurationMs: expect.anything(),
      executionDeadlineAt: null,
    })
    const casConditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(casConditions).toContainEqual({
      type: 'eq',
      left: 'workflowExecutionLogs.executionId',
      right: 'execution-1',
    })
    expect(casConditions).toContainEqual({
      type: 'eq',
      left: 'workflowExecutionLogs.workflowId',
      right: 'workflow-1',
    })
    expect(casConditions).toContainEqual({
      type: 'inArray',
      column: 'workflowExecutionLogs.status',
      values: ['running', 'pending', 'cancelled'],
    })
  })

  it('does not release again when cancellation is already terminal', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ status: 'cancelled' }])
      .mockResolvedValueOnce([{ id: 'paused-exec-1', status: 'cancelled' }])

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('repairs a late pause and releases its claimed resume after the log is cancelled', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'paused' }])
    queueTableRows(resumeQueue, [{ id: 'resume-entry-1' }])

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'cancelled',
      updatedAt: expect.any(Date),
      nextResumeAt: null,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'failed',
      completedAt: expect.any(Date),
      failureReason: 'Paused execution cancelled',
    })
    expect(mockReleaseExecutionSlot).toHaveBeenCalledOnce()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('resume-entry-1')
  })

  it('locks the workflow log before the pause row when completing cancellation', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'cancelling' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ status: 'cancelled' }])

    await expect(
      PauseResumeManager.completePausedCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(true)

    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(1, workflowExecutionLogs)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, pausedExecutions)
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

  it('reports an active claimed resume distinctly from an idle pause', async () => {
    queueTableRows(resumeQueue, [{ id: 'resume-1' }])

    await expect(
      PauseResumeManager.getPausedCancellationStatus('execution-1', 'workflow-1')
    ).resolves.toBe('active_resume')
  })

  it('returns the exact claimed resume cancellation target scoped to the workflow', async () => {
    queueTableRows(resumeQueue, [
      {
        resumeEntryId: 'resume-entry-1',
        pausedExecutionId: 'paused-exec-1',
        parentExecutionId: 'execution-1',
        resumeExecutionId: 'resume-execution-1',
      },
    ])

    await expect(
      PauseResumeManager.getActiveResumeCancellationTarget('execution-1', 'workflow-1')
    ).resolves.toEqual({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      resumeExecutionId: 'resume-execution-1',
    })

    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(conditions).toContainEqual({
      type: 'eq',
      left: 'resumeQueue.parentExecutionId',
      right: 'execution-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: 'pausedExecutions.workflowId',
      right: 'workflow-1',
    })
    expect(conditions).toContainEqual({
      type: 'eq',
      left: 'resumeQueue.status',
      right: 'claimed',
    })
  })

  it('rolls back a staged cancellation only while the same resume remains claimed', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'cancelling' }])
    queueTableRows(resumeQueue, [
      {
        id: 'resume-entry-1',
        contextId: 'context-1',
        parentExecutionId: 'execution-1',
        pausedExecutionId: 'paused-exec-1',
        status: 'claimed',
      },
    ])
    queueTableRows(resumeQueue, [{ id: 'resume-entry-1' }])

    await expect(
      PauseResumeManager.rollbackActiveResumeCancellation(
        'execution-1',
        'workflow-1',
        'resume-entry-1'
      )
    ).resolves.toBe(true)

    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(1, workflowExecutionLogs)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, pausedExecutions)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(3, resumeQueue)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(4, resumeQueue)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      status: expect.anything(),
      updatedAt: expect.any(Date),
    })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      status: 'pending',
      completedAt: null,
      failureReason: null,
    })
  })

  it('recovers when the exact resume finishes while cancellation is staged', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'cancelling' }])
    queueTableRows(resumeQueue, [
      {
        id: 'resume-entry-1',
        contextId: 'context-1',
        parentExecutionId: 'execution-1',
        pausedExecutionId: 'paused-exec-1',
        status: 'failed',
      },
    ])
    queueTableRows(resumeQueue, [])
    const processQueuedResumesSpy = vi
      .spyOn(PauseResumeManager, 'processQueuedResumes')
      .mockResolvedValueOnce()

    try {
      await expect(
        PauseResumeManager.rollbackActiveResumeCancellation(
          'execution-1',
          'workflow-1',
          'resume-entry-1'
        )
      ).resolves.toBe(true)

      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          automaticResumeRetryCount: 0,
          nextResumeAt: null,
          pausePoints: expect.anything(),
          metadata: expect.anything(),
          status: expect.anything(),
          updatedAt: expect.any(Date),
        })
      )
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
        status: 'pending',
        completedAt: null,
        failureReason: null,
      })
      expect(processQueuedResumesSpy).toHaveBeenCalledWith('execution-1', 'workflow-1')
    } finally {
      processQueuedResumesSpy.mockRestore()
    }
  })

  it('keeps cancellation staged when another resume has already been claimed', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'cancelling' }])
    queueTableRows(resumeQueue, [
      {
        id: 'resume-entry-1',
        contextId: 'context-1',
        parentExecutionId: 'execution-1',
        pausedExecutionId: 'paused-exec-1',
        status: 'failed',
      },
    ])
    queueTableRows(resumeQueue, [{ id: 'resume-entry-2' }])

    await expect(
      PauseResumeManager.rollbackActiveResumeCancellation(
        'execution-1',
        'workflow-1',
        'resume-entry-1'
      )
    ).resolves.toBe(false)

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('does not roll back after the workflow log becomes terminal', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1', status: 'cancelling' }])
    queueTableRows(resumeQueue, [
      {
        id: 'resume-entry-1',
        contextId: 'context-1',
        parentExecutionId: 'execution-1',
        pausedExecutionId: 'paused-exec-1',
        status: 'claimed',
      },
    ])
    queueTableRows(resumeQueue, [{ id: 'resume-entry-1' }])

    await expect(
      PauseResumeManager.rollbackActiveResumeCancellation(
        'execution-1',
        'workflow-1',
        'resume-entry-1'
      )
    ).resolves.toBe(false)

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('restores only cancellation-staged queue entries while the workflow remains active', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1' }])
    const processQueuedResumesSpy = vi
      .spyOn(PauseResumeManager, 'processQueuedResumes')
      .mockResolvedValueOnce()

    try {
      await PauseResumeManager.clearPausedCancellationIntent('execution-1', 'workflow-1')

      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
        status: expect.anything(),
        updatedAt: expect.any(Date),
      })
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
        status: 'pending',
        completedAt: null,
        failureReason: null,
      })
      const queueRestoreConditions = flattenMockConditions(
        dbChainMockFns.where.mock.calls.at(-1)?.[0]
      )
      expect(queueRestoreConditions).toContainEqual({
        type: 'eq',
        left: 'resumeQueue.failureReason',
        right: 'Paused execution cancellation requested',
      })
      expect(processQueuedResumesSpy).toHaveBeenCalledWith('execution-1', 'workflow-1')
    } finally {
      processQueuedResumesSpy.mockRestore()
    }
  })

  it('does not revive or dispatch staged queue entries after the workflow becomes terminal', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'completed' }])
    queueTableRows(pausedExecutions, [{ id: 'paused-exec-1' }])
    const processQueuedResumesSpy = vi.spyOn(PauseResumeManager, 'processQueuedResumes')

    try {
      await PauseResumeManager.clearPausedCancellationIntent('execution-1', 'workflow-1')

      expect(dbChainMockFns.set).toHaveBeenCalledOnce()
      expect(processQueuedResumesSpy).not.toHaveBeenCalled()
    } finally {
      processQueuedResumesSpy.mockRestore()
    }
  })

  it('blocks new resumes without treating a claimed resume as an idle late pause', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'paused-exec-1' }])
      .mockResolvedValueOnce([{ id: 'resume-1' }])

    await expect(
      PauseResumeManager.blockQueuedResumesForCancellation('execution-1', 'workflow-1')
    ).resolves.toBe(false)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelling' })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Paused execution cancellation requested',
      })
    )
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
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ automaticResumeRetryCount: 0, status: 'paused' }])

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

  it('keeps the workflow log claimable while manual cancellation is staged', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ automaticResumeRetryCount: 0, status: 'cancelling' }])

    await PauseResumeManager.markResumeAttemptFailed({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
      failureReason: 'Resume execution cancelled',
    })

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ executionDeadlineAt: null })
    )
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
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ automaticResumeRetryCount: 3, status: 'paused' }])

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

describe('PauseResumeManager terminal resume failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  async function markResumeFailed(): Promise<void> {
    const managerInternals = PauseResumeManager as unknown as PauseResumeManagerInternals
    await managerInternals.markResumeFailed({
      resumeEntryId: 'resume-entry-1',
      pausedExecutionId: 'paused-exec-1',
      parentExecutionId: 'execution-1',
      contextId: 'context-1',
      failureReason: 'Resume execution failed',
    })
  }

  it('terminalizes the parent log: end timestamp, derived duration, deadline cleared', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'running' }])
    queueTableRows(pausedExecutions, [{ status: 'paused' }])

    await markResumeFailed()

    const logUpdate = dbChainMockFns.set.mock.calls.at(-1)?.[0] as {
      status: string
      endedAt: Date
      totalDurationMs: unknown
      executionDeadlineAt: Date | null
    }
    expect(logUpdate.status).toBe('failed')
    expect(logUpdate.endedAt).toBeInstanceOf(Date)
    expect(logUpdate.executionDeadlineAt).toBeNull()
    expect(JSON.stringify(logUpdate.totalDurationMs)).toContain(logUpdate.endedAt.toISOString())
  })
})

describe('PauseResumeManager completed resume transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  interface MockSqlFragment {
    values: unknown[]
    toSQL: () => { sql: string }
  }

  async function markPartialResumeCompleted(logStatus: string): Promise<void> {
    queueTableRows(workflowExecutionLogs, [{ status: logStatus }])
    queueTableRows(pausedExecutions, [{ status: 'paused' }])
    queueTableRows(resumeQueue, [{ status: 'claimed' }])
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
  }

  /** The revival is the third write: resume queue, paused execution, then the log. */
  function revivalPayload(): {
    status: string
    executionDeadlineAt: Date | null
    endedAt: MockSqlFragment
    totalDurationMs: MockSqlFragment
  } {
    return dbChainMockFns.set.mock.calls.at(-1)?.[0]
  }

  it('clears the active attempt deadline when sibling pause points remain', async () => {
    await markPartialResumeCompleted('running')

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(3)
    const revival = revivalPayload()
    expect(revival.status).toBe('pending')
    expect(revival.executionDeadlineAt).toBeNull()
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(1, workflowExecutionLogs)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, pausedExecutions)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(3, resumeQueue)
  })

  /**
   * The revival claim excludes only `cancelled`, so it also matches a row
   * `markResumeFailed` already ended: one context's resume fails, a sibling
   * context resumes successfully afterwards, and the run goes live again. It
   * must not go live still carrying the end timestamp and duration of the
   * attempt that failed — a run waiting on its remaining pause points has not
   * ended, and reporting that it has puts it in the `minDurationMs`/
   * `maxDurationMs` filters on `GET /api/v2/logs` with a duration measured at
   * something other than its own end.
   */
  it('clears the terminal stamp when a partial resume revives a force-failed row', async () => {
    await markPartialResumeCompleted('failed')

    const revival = revivalPayload()
    expect(Object.keys(revival).sort()).toEqual([
      'endedAt',
      'executionDeadlineAt',
      'status',
      'totalDurationMs',
    ])
    expect(revival.status).toBe('pending')
    expect(revival.endedAt.toSQL().sql).toContain("IN ('failed', 'completed') THEN NULL")
    expect(revival.totalDurationMs.toSQL().sql).toContain("IN ('failed', 'completed') THEN NULL")
    expect(revival.endedAt.values[0]).toBe(workflowExecutionLogs.status)
    expect(revival.totalDurationMs.values[0]).toBe(workflowExecutionLogs.status)
  })

  /**
   * The opposite case, and the reason the clear is conditional rather than
   * unconditional: a row revived from a non-terminal status carries the
   * checkpoint `completeWithPause` banked, which is the active duration
   * `elapsedDurationMsSql` deliberately preserves for a `pending` row. Nulling
   * that would redefine a later terminal duration to include the time the run
   * sat waiting.
   */
  it('keeps the checkpoint a still-live row banked at its pause', async () => {
    await markPartialResumeCompleted('running')

    const revival = revivalPayload()
    expect(revival.endedAt.toSQL().sql).toContain('ELSE ?')
    expect(revival.totalDurationMs.toSQL().sql).toContain('ELSE ?')
    expect(revival.endedAt.values.at(-1)).toBe(workflowExecutionLogs.endedAt)
    expect(revival.totalDurationMs.values.at(-1)).toBe(workflowExecutionLogs.totalDurationMs)
  })

  /**
   * The compounding half. `elapsedDurationMsSql` preserves a `pending` row's
   * `total_duration_ms` and recomputes otherwise, so whatever the revival leaves
   * behind is what the next terminal write — a cancel, say — records as the run's
   * duration. Leaving the failed resume's frozen value there would freeze the
   * cancel at it; leaving `NULL` is what makes the `COALESCE` fall through to the
   * elapsed computation.
   *
   * The link is asserted as a composition rather than executed: the repository
   * has no in-memory Postgres, and under the drizzle mock a fragment renders its
   * interpolations as `?` with the bound columns on `values`.
   */
  it('lets the next terminal write recompute rather than preserve the failed resume duration', async () => {
    await markPartialResumeCompleted('failed')

    const revived = revivalPayload().totalDurationMs
    expect(revived.toSQL().sql).toContain("IN ('failed', 'completed') THEN NULL")

    const nextTerminalWrite = terminalExecutionLogFields(
      'cancelled',
      new Date('2026-08-14T12:00:00.000Z')
    ).totalDurationMs as unknown as MockSqlFragment
    expect(nextTerminalWrite.toSQL().sql).toContain("= 'pending' THEN ?")
    expect(nextTerminalWrite.values).toContain(workflowExecutionLogs.totalDurationMs)
  })

  it('fails a claimed resume after cancellation wins the log lock', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ status: 'cancelled' }])
    queueTableRows(resumeQueue, [{ status: 'claimed' }])
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

    expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'failed',
      completedAt: expect.any(Date),
      failureReason: 'Paused execution cancelled',
    })
  })

  it('does not overwrite a resume already failed by cancellation', async () => {
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ status: 'cancelled' }])
    queueTableRows(resumeQueue, [{ status: 'failed' }])
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

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('derives a contextless re-pause identity before honoring cancellation', async () => {
    queueTableRows(resumeQueue, [
      { parentExecutionId: 'execution-1', pausedExecutionId: 'paused-exec-1' },
    ])
    queueTableRows(workflowExecutionLogs, [{ status: 'cancelled' }])
    queueTableRows(pausedExecutions, [{ status: 'cancelled' }])
    queueTableRows(resumeQueue, [{ status: 'claimed' }])
    const markResumeCompleted = Reflect.get(PauseResumeManager, 'markResumeCompleted') as (args: {
      resumeEntryId: string
    }) => Promise<void>

    await markResumeCompleted({
      resumeEntryId: 'resume-entry-1',
    })

    expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'failed',
      completedAt: expect.any(Date),
      failureReason: 'Paused execution cancelled',
    })
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(2, workflowExecutionLogs)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(3, pausedExecutions)
    expect(dbChainMockFns.from).toHaveBeenNthCalledWith(4, resumeQueue)
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
      (condition) =>
        condition.type === 'inArray' && condition.column === 'workflowExecutionLogs.status'
    )
    expect(statusGuard).toEqual({
      type: 'inArray',
      column: 'workflowExecutionLogs.status',
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

/**
 * Every refusal here is an ordinary client outcome — a stale `contextId`, a run
 * someone else already resumed, a pause of the wrong kind for the endpoint. The
 * resume surfaces classify a failure by its `statusCode`, so an untyped throw
 * for any of these reaches the caller as a `500` and tells them nothing about
 * what to fix.
 */
describe('PauseResumeManager.enqueueOrStartResume admission refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  function pausedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'paused-exec-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      status: 'paused',
      pausePoints: {
        'ctx-1': { contextId: 'ctx-1', resumeStatus: 'paused', snapshotReady: true },
      },
      ...overrides,
    }
  }

  function enqueue(allowedPauseKinds?: ('human' | 'time')[]) {
    return PauseResumeManager.enqueueOrStartResume({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      contextId: 'ctx-1',
      resumeInput: {},
      userId: 'user-1',
      allowedPauseKinds,
    })
  }

  it.each([
    ['a run with no paused row', undefined, 404, 'Paused execution not found or already resumed'],
    [
      'a paused row in a terminal state',
      pausedRow({ status: 'cancelled' }),
      409,
      'Paused execution is not resumable',
    ],
    [
      'an unknown pause point',
      pausedRow({ pausePoints: {} }),
      404,
      'Pause point not found for execution',
    ],
    [
      'a pause point already being resumed',
      pausedRow({
        pausePoints: { 'ctx-1': { resumeStatus: 'resuming', snapshotReady: true } },
      }),
      409,
      'Pause point already resumed or in progress',
    ],
    [
      'a pause still finalizing its snapshot',
      pausedRow({ pausePoints: { 'ctx-1': { resumeStatus: 'paused', snapshotReady: false } } }),
      409,
      'Snapshot not ready; execution still finalizing pause',
    ],
  ])('reports %s with its own status', async (_case, row, statusCode, message) => {
    dbChainMockFns.limit.mockResolvedValueOnce(row ? [row] : [])

    await expect(enqueue()).rejects.toMatchObject({
      name: 'ResumeAdmissionError',
      message,
      statusCode,
    })
  })

  it('reports a pause of the wrong kind for the endpoint as a bad request', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      pausedRow({
        pausePoints: {
          'ctx-1': { resumeStatus: 'paused', snapshotReady: true, pauseKind: 'time' },
        },
      }),
    ])

    await expect(enqueue(['human'])).rejects.toMatchObject({
      name: 'ResumeAdmissionError',
      statusCode: 400,
    })
  })

  /**
   * A snapshot that has not finished persisting is the one refusal that a later
   * automatic attempt can clear; the rest read identically on every retry.
   */
  it('marks only the still-finalizing snapshot as worth retrying', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      pausedRow({ pausePoints: { 'ctx-1': { resumeStatus: 'paused', snapshotReady: false } } }),
    ])
    await expect(enqueue()).rejects.toMatchObject({ retryable: true })

    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(enqueue()).rejects.toMatchObject({ retryable: false })
  })
})
