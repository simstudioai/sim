/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { serializePauseSnapshot } from '@/executor/execution/snapshot-serializer'
import type { ExecutionContext } from '@/executor/types'

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: {
      requestId: 'request-1',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      triggerType: 'manual',
      useDraftState: true,
      startTime: '2026-01-01T00:00:00.000Z',
    },
    environmentVariables: {},
    decisions: {
      router: new Map(),
      condition: new Map(),
    },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    ...overrides,
  } as ExecutionContext
}

describe('serializePauseSnapshot', () => {
  it('serializes batched parallel accumulated outputs for cross-process resume', () => {
    const context = createContext({
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 3,
            branchOutputs: new Map([[2, [{ output: 'current-batch' }]]]),
            accumulatedOutputs: new Map([
              [0, [{ output: 'batch-0' }]],
              [1, [{ output: 'batch-1' }]],
            ]),
          },
        ],
      ]),
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.parallelExecutions?.['parallel-1']).toMatchObject({
      branchOutputs: {
        2: [{ output: 'current-batch' }],
      },
      accumulatedOutputs: {
        0: [{ output: 'batch-0' }],
        1: [{ output: 'batch-1' }],
      },
    })
  })

  it('rejects oversized snapshot values without full JSON serialization', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('full stringify should not be used for compactness checks')
    })
    const context = createContext({
      workflowVariables: {
        oversized: {
          type: 'string',
          value: 'x'.repeat(9 * 1024 * 1024),
        },
      },
    })

    try {
      expect(() => serializePauseSnapshot(context, ['next-block'])).toThrow(
        'Cannot serialize pause snapshot with oversized workflow variables'
      )
    } finally {
      stringifySpy.mockRestore()
    }
  })
})
