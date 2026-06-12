/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import { EdgeManager } from '@/executor/execution/edge-manager'
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

  it('serializes deactivated edge state for resume', () => {
    const context = createContext()
    const sourceNode = {
      id: 'condition',
      block: {} as DAGNode['block'],
      incomingEdges: new Set<string>(),
      outgoingEdges: new Map([['if-edge', { target: 'target', sourceHandle: 'condition-if' }]]),
      metadata: {},
    }
    const targetNode = {
      id: 'target',
      block: {} as DAGNode['block'],
      incomingEdges: new Set(['condition']),
      outgoingEdges: new Map(),
      metadata: {},
    }
    const activeSourceNode = {
      id: 'active-source',
      block: {} as DAGNode['block'],
      incomingEdges: new Set<string>(),
      outgoingEdges: new Map([['active-edge', { target: 'active-target' }]]),
      metadata: {},
    }
    const activeTargetNode = {
      id: 'active-target',
      block: {} as DAGNode['block'],
      incomingEdges: new Set(['active-source']),
      outgoingEdges: new Map(),
      metadata: {},
    }
    const dag: DAG = {
      nodes: new Map([
        [sourceNode.id, sourceNode],
        [targetNode.id, targetNode],
        [activeSourceNode.id, activeSourceNode],
        [activeTargetNode.id, activeTargetNode],
      ]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const edgeManager = new EdgeManager(dag)
    edgeManager.processOutgoingEdges(sourceNode, { selectedOption: 'else' })
    edgeManager.processOutgoingEdges(activeSourceNode, { result: true })

    const snapshot = serializePauseSnapshot(context, ['next-block'], dag, edgeManager)
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.deactivatedEdges).toHaveLength(1)
    expect(serialized.state.nodesWithActivatedEdge).toEqual(['active-target'])
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

  it('preserves an explicit useDraftState=true even when the context is a deployed (server-side) context', () => {
    const context = createContext({
      isDeployedContext: true,
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
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.metadata.useDraftState).toBe(true)
  })
})
