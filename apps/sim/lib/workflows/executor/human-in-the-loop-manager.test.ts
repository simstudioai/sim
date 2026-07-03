/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import {
  PauseResumeManager,
  updateResumeOutputInAggregationBuffers,
} from '@/lib/workflows/executor/human-in-the-loop-manager'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { PausePoint, SerializedSnapshot } from '@/executor/types'

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

  it('preserves the stashed cellContext when an existing paused row re-pauses (chained waits)', async () => {
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
        'ctx-wait-1': { contextId: 'ctx-wait-1', blockId: 'wait1', resumeStatus: 'resuming' },
      },
      metadata: {
        pauseScope: 'execution',
        triggerIds: ['start'],
        executorUserId: 'user-1',
        cellContext,
      },
    }

    // First `.limit(1)` resolves the select-for-update to the existing row,
    // forcing persistPauseResult down the update (not insert) branch.
    dbChainMockFns.limit.mockResolvedValueOnce([existingRow])

    const snapshotSeed: SerializedSnapshot = { snapshot: '{}', triggerIds: [] }
    const pausePoints: PausePoint[] = [
      {
        contextId: 'ctx-wait-2',
        blockId: 'wait2',
        pauseKind: 'time',
        resumeAt: new Date(Date.now() + 60_000).toISOString(),
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

    const updatedMetadata = (updateSetCall![0] as { metadata: Record<string, unknown> }).metadata
    expect(updatedMetadata.cellContext).toEqual(cellContext)
    expect(updatedMetadata.pauseScope).toBe('execution')
    expect(updatedMetadata.executorUserId).toBe('user-1')
  })
})
