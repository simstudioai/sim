/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { BlockStateController } from '@/executor/execution/types'
import { LoopOrchestrator } from '@/executor/orchestrators/loop'

function createNode(id: string): DAGNode {
  return {
    id,
    block: {
      id,
      position: { x: 0, y: 0 },
      enabled: true,
      metadata: { id: 'function', name: id },
      config: { params: {} },
      inputs: {},
      outputs: {},
    },
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {},
  }
}

function createState(): BlockStateController {
  return {
    getBlockOutput: vi.fn(),
    hasExecuted: vi.fn(() => false),
    setBlockOutput: vi.fn(),
    setBlockState: vi.fn(),
    deleteBlockState: vi.fn(),
    unmarkExecuted: vi.fn(),
  }
}

describe('LoopOrchestrator', () => {
  it('does not restore parallel_continue back edges for nested parallels', () => {
    const loopId = 'loop-1'
    const parallelId = 'parallel-1'
    const loopStartId = `loop-${loopId}-sentinel-start`
    const loopEndId = `loop-${loopId}-sentinel-end`
    const parallelStartId = `parallel-${parallelId}-sentinel-start`
    const parallelEndId = `parallel-${parallelId}-sentinel-end`
    const loopStart = createNode(loopStartId)
    const loopEnd = createNode(loopEndId)
    const parallelStart = createNode(parallelStartId)
    const parallelEnd = createNode(parallelEndId)
    loopStart.outgoingEdges.set(`${loopStartId}->${parallelStartId}`, { target: parallelStartId })
    parallelEnd.outgoingEdges.set(`${parallelEndId}->${parallelStartId}-continue`, {
      target: parallelStartId,
      sourceHandle: EDGE.PARALLEL_CONTINUE,
    })
    parallelEnd.outgoingEdges.set(`${parallelEndId}->${loopEndId}-exit`, {
      target: loopEndId,
      sourceHandle: EDGE.PARALLEL_EXIT,
    })

    const dag: DAG = {
      nodes: new Map([
        [loopStartId, loopStart],
        [loopEndId, loopEnd],
        [parallelStartId, parallelStart],
        [parallelEndId, parallelEnd],
      ]),
      loopConfigs: new Map([[loopId, { id: loopId, nodes: [parallelId], loopType: 'for' }]]),
      parallelConfigs: new Map([
        [parallelId, { id: parallelId, nodes: [], parallelType: 'count' }],
      ]),
    }
    const edgeManager = {
      clearDeactivatedEdgesForNodes: vi.fn(),
    } as unknown as EdgeManager
    const orchestrator = new LoopOrchestrator(dag, createState(), null as any, {}, edgeManager)

    orchestrator.restoreLoopEdges(loopId)

    expect(parallelStart.incomingEdges.has(loopStartId)).toBe(true)
    expect(parallelStart.incomingEdges.has(parallelEndId)).toBe(false)
  })

  it('resolves forEach collections with the loop start sentinel scope', async () => {
    const loopId = 'loop-1'
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map([
        [
          loopId,
          {
            id: loopId,
            nodes: ['task-1'],
            loopType: 'forEach',
            forEachItems: '<Producer.items>',
          },
        ],
      ]),
      parallelConfigs: new Map(),
    }
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(['item-1']),
    }
    const orchestrator = new LoopOrchestrator(dag, createState(), resolver as any, {}, {
      clearDeactivatedEdgesForNodes: vi.fn(),
    } as unknown as EdgeManager)
    const ctx = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'user-1',
      loopExecutions: new Map(),
      blockLogs: [],
      metadata: {},
    }

    const scope = await orchestrator.initializeLoopScope(ctx as any, loopId)

    expect(resolver.resolveSingleReference).toHaveBeenCalledWith(
      expect.any(Object),
      'loop-loop-1-sentinel-start',
      '<Producer.items>'
    )
    expect(scope.maxIterations).toBe(1)
  })

  it('exits immediately when a loop was skipped at start', async () => {
    const loopId = 'loop-1'
    const state = createState()
    const dag: DAG = {
      nodes: new Map(),
      loopConfigs: new Map([[loopId, { id: loopId, nodes: ['task-1'], loopType: 'while' }]]),
      parallelConfigs: new Map(),
    }
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(1),
    }
    const orchestrator = new LoopOrchestrator(dag, state, resolver as any, {}, {
      clearDeactivatedEdgesForNodes: vi.fn(),
    } as unknown as EdgeManager)
    const ctx = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'user-1',
      loopExecutions: new Map([
        [
          loopId,
          {
            iteration: 0,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
            loopType: 'while',
            condition: '<loop.index> > 0',
            skippedAtStart: true,
          },
        ],
      ]),
      blockLogs: [],
      metadata: {},
    }

    const result = await orchestrator.evaluateLoopContinuation(ctx as any, loopId)

    expect(result).toMatchObject({
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
      aggregatedResults: [],
    })
    expect(resolver.resolveSingleReference).not.toHaveBeenCalled()
    expect(state.setBlockOutput).toHaveBeenCalledWith(loopId, { results: [] }, 0)
  })
})
