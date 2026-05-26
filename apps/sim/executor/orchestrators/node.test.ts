/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { BlockExecutor } from '@/executor/execution/block-executor'
import type { BlockStateController } from '@/executor/execution/types'
import type { LoopOrchestrator } from '@/executor/orchestrators/loop'
import { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import type { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { ExecutionContext } from '@/executor/types'

function createContext(): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: {
      router: new Map(),
      condition: new Map(),
    },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    workflow: {
      version: '1',
      blocks: [],
      connections: [],
      loops: {},
      parallels: {},
    },
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

function createSentinelNode(id: string, sentinelType: 'start' | 'end'): DAGNode {
  return {
    id,
    block: {
      id,
      position: { x: 0, y: 0 },
      enabled: true,
      metadata: { id: 'parallel', name: id },
      config: { params: {} },
      inputs: {},
      outputs: {},
    },
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {
      isSentinel: true,
      sentinelType,
      subflowId: 'parallel-1',
      subflowType: 'parallel',
    },
  }
}

function createOrchestrator(
  dag: DAG,
  state: BlockStateController,
  parallelOrchestrator: Partial<ParallelOrchestrator>,
  loopOrchestratorOverrides: Partial<LoopOrchestrator> = {}
): NodeExecutionOrchestrator {
  const blockExecutor = { execute: vi.fn() } as unknown as BlockExecutor
  const loopOrchestrator = {
    getLoopScope: vi.fn(),
    initializeLoopScope: vi.fn(),
    evaluateInitialCondition: vi.fn(),
    evaluateLoopContinuation: vi.fn(),
    clearLoopExecutionState: vi.fn(),
    restoreLoopEdges: vi.fn(),
    storeLoopNodeOutput: vi.fn(),
    ...loopOrchestratorOverrides,
  } as unknown as LoopOrchestrator

  return new NodeExecutionOrchestrator(
    dag,
    state,
    blockExecutor,
    loopOrchestrator,
    parallelOrchestrator as ParallelOrchestrator
  )
}

describe('NodeExecutionOrchestrator parallel sentinel batching', () => {
  it('returns loop_exit from a loop start sentinel when the initial condition is false', async () => {
    const startNode = {
      ...createSentinelNode('loop-loop-1-sentinel-start', 'start'),
      metadata: {
        isSentinel: true,
        sentinelType: 'start' as const,
        subflowId: 'loop-1',
        subflowType: 'loop' as const,
      },
    }
    const dag: DAG = {
      nodes: new Map([[startNode.id, startNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const loopOrchestrator = {
      getLoopScope: vi.fn(() => ({})),
      evaluateInitialCondition: vi.fn().mockResolvedValue(false),
    }
    const orchestrator = createOrchestrator(dag, state, {}, loopOrchestrator)

    const result = await orchestrator.executeNode(createContext(), startNode.id)

    expect(result.output).toMatchObject({
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
    })
  })

  it('prepares the current batch when executing a parallel start sentinel', async () => {
    const startNode = createSentinelNode('parallel-parallel-1-sentinel-start', 'start')
    const dag: DAG = {
      nodes: new Map([[startNode.id, startNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const parallelOrchestrator = {
      getParallelScope: vi.fn(() => ({ parallelId: 'parallel-1', totalBranches: 2 })),
      initializeParallelScope: vi.fn(),
      prepareCurrentBatch: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, parallelOrchestrator)

    const result = await orchestrator.executeNode(createContext(), startNode.id)

    expect(result.output).toEqual({ sentinelStart: true })
    expect(parallelOrchestrator.prepareCurrentBatch).toHaveBeenCalledWith(
      expect.any(Object),
      'parallel-1'
    )
  })

  it('returns parallel_exit from an empty parallel start sentinel without preparing a batch', async () => {
    const startNode = createSentinelNode('parallel-parallel-1-sentinel-start', 'start')
    const dag: DAG = {
      nodes: new Map([[startNode.id, startNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const parallelOrchestrator = {
      getParallelScope: vi.fn(() => ({
        parallelId: 'parallel-1',
        totalBranches: 0,
        isEmpty: true,
      })),
      initializeParallelScope: vi.fn(),
      prepareCurrentBatch: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, parallelOrchestrator)

    const result = await orchestrator.executeNode(createContext(), startNode.id)

    expect(result.output).toMatchObject({
      shouldExit: true,
      selectedRoute: EDGE.PARALLEL_EXIT,
    })
    expect(parallelOrchestrator.prepareCurrentBatch).not.toHaveBeenCalled()
  })

  it('prepares a batch continuation when parallel end selects parallel_continue', async () => {
    const endNode = createSentinelNode('parallel-parallel-1-sentinel-end', 'end')
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const parallelOrchestrator = {
      getParallelScope: vi.fn(),
      prepareForBatchContinuation: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, parallelOrchestrator)

    await orchestrator.handleNodeCompletion(createContext(), endNode.id, {
      selectedRoute: EDGE.PARALLEL_CONTINUE,
    })

    expect(state.setBlockOutput).toHaveBeenCalledWith(endNode.id, {
      selectedRoute: EDGE.PARALLEL_CONTINUE,
    })
    expect(parallelOrchestrator.prepareForBatchContinuation).toHaveBeenCalledWith('parallel-1')
  })

  it('marks terminal parallel exit output as final when only the continue back edge remains', async () => {
    const endNode = createSentinelNode('parallel-parallel-1-sentinel-end', 'end')
    endNode.outgoingEdges.set('continue', {
      target: 'parallel-parallel-1-sentinel-start',
      sourceHandle: EDGE.PARALLEL_CONTINUE,
    })
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const parallelOrchestrator = {
      getParallelScope: vi.fn(() => ({ parallelId: 'parallel-1', totalBranches: 1 })),
      aggregateParallelResults: vi.fn().mockResolvedValue({
        allBranchesComplete: true,
        results: [['result']],
        totalBranches: 1,
      }),
    }
    const orchestrator = createOrchestrator(dag, createState(), parallelOrchestrator)

    const result = await orchestrator.executeNode(createContext(), endNode.id)

    expect(result.isFinalOutput).toBe(true)
    expect(result.output).toMatchObject({
      results: [['result']],
      selectedRoute: EDGE.PARALLEL_EXIT,
    })
  })

  it('does not mark a continuing parallel batch as final output', async () => {
    const endNode = createSentinelNode('parallel-parallel-1-sentinel-end', 'end')
    endNode.outgoingEdges.set('continue', {
      target: 'parallel-parallel-1-sentinel-start',
      sourceHandle: EDGE.PARALLEL_CONTINUE,
    })
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const parallelOrchestrator = {
      getParallelScope: vi.fn(() => ({ parallelId: 'parallel-1', totalBranches: 3 })),
      aggregateParallelResults: vi.fn().mockResolvedValue({
        allBranchesComplete: false,
        totalBranches: 3,
      }),
    }
    const orchestrator = createOrchestrator(dag, createState(), parallelOrchestrator)

    const result = await orchestrator.executeNode(createContext(), endNode.id)

    expect(result.isFinalOutput).toBe(false)
    expect(result.output).toMatchObject({
      selectedRoute: EDGE.PARALLEL_CONTINUE,
    })
  })

  it('records completed nested subflow sentinels as parent parallel branch output', async () => {
    const endNode = {
      ...createSentinelNode('loop-nested-loop-sentinel-end', 'end'),
      metadata: {
        isSentinel: true,
        sentinelType: 'end' as const,
        subflowId: 'nested-loop',
        subflowType: 'loop' as const,
      },
    }
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const parallelOrchestrator = {
      getParallelScope: vi.fn(),
      handleParallelBranchCompletion: vi.fn(),
      prepareForBatchContinuation: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, parallelOrchestrator)
    const ctx = createContext()
    ctx.subflowParentMap = new Map([
      ['nested-loop', { parentId: 'parent-parallel', parentType: 'parallel', branchIndex: 3 }],
    ])

    await orchestrator.handleNodeCompletion(ctx, endNode.id, {
      results: ['loop-result'],
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
    })

    expect(parallelOrchestrator.handleParallelBranchCompletion).toHaveBeenCalledWith(
      ctx,
      'parent-parallel',
      endNode.id,
      { results: ['loop-result'] },
      3
    )
  })

  it('does not record continuing nested parallel batches as parent parallel branch output', async () => {
    const endNode = {
      ...createSentinelNode('parallel-nested-parallel-sentinel-end', 'end'),
      metadata: {
        isSentinel: true,
        sentinelType: 'end' as const,
        subflowId: 'nested-parallel',
        subflowType: 'parallel' as const,
      },
    }
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const parallelOrchestrator = {
      getParallelScope: vi.fn(),
      handleParallelBranchCompletion: vi.fn(),
      prepareForBatchContinuation: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, parallelOrchestrator)
    const ctx = createContext()
    ctx.subflowParentMap = new Map([
      ['nested-parallel', { parentId: 'parent-parallel', parentType: 'parallel', branchIndex: 3 }],
    ])

    await orchestrator.handleNodeCompletion(ctx, endNode.id, {
      sentinelEnd: true,
      selectedRoute: EDGE.PARALLEL_CONTINUE,
    })

    expect(parallelOrchestrator.handleParallelBranchCompletion).not.toHaveBeenCalled()
  })

  it('writes stable outer-branch output aliases for completed parallel branch nodes', async () => {
    const branchNode: DAGNode = {
      id: 'worker₍0₎',
      block: {
        id: 'worker',
        position: { x: 0, y: 0 },
        enabled: true,
        metadata: { id: 'function', name: 'Worker' },
        config: { params: {} },
        inputs: {},
        outputs: {},
      },
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isParallelBranch: true,
        subflowId: 'parallel-1',
        subflowType: 'parallel',
        originalBlockId: 'worker',
        branchIndex: 2,
      },
    }
    const dag: DAG = {
      nodes: new Map([[branchNode.id, branchNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const parallelOrchestrator = {
      getParallelScope: vi.fn(() => ({ parallelId: 'parallel-1', totalBranches: 3 })),
      initializeParallelScope: vi.fn(),
      handleParallelBranchCompletion: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, parallelOrchestrator)
    const output = { result: 'branch-2' }
    const ctx = createContext()

    await orchestrator.handleNodeCompletion(ctx, branchNode.id, output)

    expect(parallelOrchestrator.handleParallelBranchCompletion).toHaveBeenCalledWith(
      ctx,
      'parallel-1',
      branchNode.id,
      output
    )
    expect(state.setBlockOutput).toHaveBeenCalledWith('worker__obranch-2', output)
    expect(state.setBlockOutput).toHaveBeenCalledWith(branchNode.id, output)
  })

  it('records completed nested subflow sentinels as parent loop iteration output', async () => {
    const endNode = {
      ...createSentinelNode('parallel-nested-parallel-sentinel-end', 'end'),
      metadata: {
        isSentinel: true,
        sentinelType: 'end' as const,
        subflowId: 'nested-parallel',
        subflowType: 'parallel' as const,
      },
    }
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const loopOrchestrator = {
      storeLoopNodeOutput: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, {}, loopOrchestrator)
    const ctx = createContext()
    ctx.subflowParentMap = new Map([
      ['nested-parallel', { parentId: 'parent-loop', parentType: 'loop' }],
    ])

    await orchestrator.handleNodeCompletion(ctx, endNode.id, {
      results: ['parallel-result'],
      sentinelEnd: true,
      selectedRoute: EDGE.PARALLEL_EXIT,
    })

    expect(loopOrchestrator.storeLoopNodeOutput).toHaveBeenCalledWith(
      ctx,
      'parent-loop',
      'nested-parallel',
      { results: ['parallel-result'] }
    )
  })

  it('does not record continuing nested loop iterations as parent loop output', async () => {
    const endNode = {
      ...createSentinelNode('loop-nested-loop-sentinel-end', 'end'),
      metadata: {
        isSentinel: true,
        sentinelType: 'end' as const,
        subflowId: 'nested-loop',
        subflowType: 'loop' as const,
      },
    }
    const dag: DAG = {
      nodes: new Map([[endNode.id, endNode]]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const state = createState()
    const loopOrchestrator = {
      storeLoopNodeOutput: vi.fn(),
    }
    const orchestrator = createOrchestrator(dag, state, {}, loopOrchestrator)
    const ctx = createContext()
    ctx.subflowParentMap = new Map([
      ['nested-loop', { parentId: 'parent-loop', parentType: 'loop' }],
    ])

    await orchestrator.handleNodeCompletion(ctx, endNode.id, {
      shouldContinue: true,
      selectedRoute: EDGE.LOOP_CONTINUE,
    })

    expect(loopOrchestrator.storeLoopNodeOutput).not.toHaveBeenCalled()
  })
})
