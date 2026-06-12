/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { ExecutionContext } from '@/executor/types'
import {
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
} from '@/executor/utils/subflow-utils'

const { mockCompactSubflowResults } = vi.hoisted(() => ({
  mockCompactSubflowResults: vi.fn(async (results: unknown) => results),
}))

vi.mock('@/lib/execution/payloads/serializer', () => ({
  compactSubflowResults: mockCompactSubflowResults,
}))

function createDag(): DAG {
  return {
    nodes: new Map(),
    loopConfigs: new Map(),
    parallelConfigs: new Map([
      [
        'parallel-1',
        {
          id: 'parallel-1',
          nodes: ['task-1'],
          distribution: [],
          parallelType: 'collection',
        },
      ],
    ]),
  }
}

function createDagNode(id: string, metadata: DAGNode['metadata'] = {}): DAGNode {
  return {
    id,
    block: {
      id,
      position: { x: 0, y: 0 },
      config: { tool: '', params: {} },
      inputs: {},
      outputs: {},
      metadata: { id: 'function', name: id },
      enabled: true,
    },
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata,
  }
}

function createState(): BlockStateWriter {
  return {
    setBlockOutput: vi.fn(),
    setBlockState: vi.fn(),
    deleteBlockState: vi.fn(),
    unmarkExecuted: vi.fn(),
  }
}

function createEdgeManager() {
  return {
    clearDeactivatedEdgesForNodes: vi.fn(),
  }
}

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
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
      blocks: [
        {
          id: 'parallel-1',
          position: { x: 0, y: 0 },
          config: { tool: '', params: {} },
          inputs: {},
          outputs: {},
          metadata: { id: 'parallel', name: 'Parallel 1' },
          enabled: true,
        },
      ],
      connections: [],
      loops: {},
      parallels: {},
    },
    ...overrides,
  }
}

describe('ParallelOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCompactSubflowResults.mockImplementation(async (results: unknown) => results)
  })

  it('defers empty-subflow lifecycle callbacks to the sentinel end path', async () => {
    const onBlockStart = vi.fn()
    const onBlockComplete = vi.fn()
    const contextExtensions: ContextExtensions = {
      onBlockStart,
      onBlockComplete,
    }
    const orchestrator = new ParallelOrchestrator(
      createDag(),
      createState(),
      null,
      contextExtensions
    )
    const ctx = createContext()

    const scope = await orchestrator.initializeParallelScope(ctx, 'parallel-1')

    expect(onBlockStart).not.toHaveBeenCalled()
    expect(onBlockComplete).not.toHaveBeenCalled()
    expect(scope.isEmpty).toBe(true)
  })

  it('returns an empty scope without emitting start-side lifecycle callbacks', async () => {
    const contextExtensions: ContextExtensions = {
      onBlockStart: vi.fn().mockRejectedValue(new Error('start failed')),
      onBlockComplete: vi.fn().mockRejectedValue(new Error('complete failed')),
    }
    const orchestrator = new ParallelOrchestrator(
      createDag(),
      createState(),
      null,
      contextExtensions
    )

    await expect(
      orchestrator.initializeParallelScope(createContext(), 'parallel-1', 1)
    ).resolves.toMatchObject({
      parallelId: 'parallel-1',
      isEmpty: true,
    })
    expect(contextExtensions.onBlockStart).not.toHaveBeenCalled()
    expect(contextExtensions.onBlockComplete).not.toHaveBeenCalled()
  })

  it('resolves collection distributions with the parallel start sentinel scope', async () => {
    const dag = createDag()
    const parallelConfig = dag.parallelConfigs.get('parallel-1')!
    parallelConfig.distribution = '<Producer.items>'
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(['item-1', 'item-2']),
    }
    const orchestrator = new ParallelOrchestrator(
      dag,
      createState(),
      resolver as any,
      {},
      undefined,
      createEdgeManager() as any
    )

    const scope = await orchestrator.initializeParallelScope(createContext(), 'parallel-1')

    expect(resolver.resolveSingleReference).toHaveBeenCalledWith(
      expect.any(Object),
      'parallel-parallel-1-sentinel-start',
      '<Producer.items>',
      undefined,
      { allowLargeValueRefs: true }
    )
    expect(scope.totalBranches).toBe(2)
  })

  it('records resumed later-batch outputs under restored global branch indexes', () => {
    const dag = createDag()
    dag.nodes.set('task-1', {
      id: 'task-1',
      block: {
        id: 'task-1',
        position: { x: 0, y: 0 },
        config: { tool: '', params: {} },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Task 1' },
        enabled: true,
      },
      incomingEdges: new Set(),
      outgoingEdges: new Set(),
      metadata: { branchIndex: 0 },
    })
    const orchestrator = new ParallelOrchestrator(dag, createState(), null, {})
    const ctx = createContext({
      parallelBlockMapping: new Map([
        ['task-1', { originalBlockId: 'task', parallelId: 'parallel-1', iterationIndex: 20 }],
      ]),
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 25,
            currentBatchStart: 20,
            currentBatchSize: 5,
            accumulatedOutputs: new Map([[0, [{ output: 'previous' }]]]),
            branchOutputs: new Map(),
          },
        ],
      ]),
    })

    orchestrator.handleParallelBranchCompletion(ctx, 'parallel-1', 'task-1', { output: 'resumed' })

    const scope = ctx.parallelExecutions?.get('parallel-1')
    expect(scope?.branchOutputs.get(20)).toEqual([{ output: 'resumed' }])
    expect(scope?.branchOutputs.has(0)).toBe(false)
  })

  it('clamps batch size and caps current batch to total branch count', async () => {
    const dag = createDag()
    const parallelConfig = dag.parallelConfigs.get('parallel-1')!
    parallelConfig.parallelType = 'count'
    parallelConfig.count = 9
    parallelConfig.batchSize = 0

    const orchestrator = new ParallelOrchestrator(dag, createState(), null, {})
    const zeroBatchScope = await orchestrator.initializeParallelScope(createContext(), 'parallel-1')

    expect(zeroBatchScope.batchSize).toBe(1)
    expect(zeroBatchScope.currentBatchSize).toBe(1)

    parallelConfig.batchSize = 50
    const oversizedBatchScope = await orchestrator.initializeParallelScope(
      createContext(),
      'parallel-1'
    )

    expect(oversizedBatchScope.currentBatchSize).toBe(9)
  })

  it.each([
    ['oversized numeric batch size', 999, DEFAULTS.MAX_PARALLEL_BRANCHES],
    ['negative batch size', -1, 1],
    ['undefined batch size', undefined, DEFAULTS.MAX_PARALLEL_BRANCHES],
    ['nonnumeric batch size', 'not-a-number', DEFAULTS.MAX_PARALLEL_BRANCHES],
  ])('normalizes %s', async (_name, batchSize, expectedBatchSize) => {
    const dag = createDag()
    const parallelConfig = dag.parallelConfigs.get('parallel-1')!
    parallelConfig.parallelType = 'count'
    parallelConfig.count = DEFAULTS.MAX_PARALLEL_BRANCHES + 10
    parallelConfig.batchSize = batchSize as never

    const orchestrator = new ParallelOrchestrator(dag, createState(), null, {})
    const scope = await orchestrator.initializeParallelScope(createContext(), 'parallel-1')

    expect(scope.batchSize).toBe(expectedBatchSize)
    expect(scope.currentBatchSize).toBe(expectedBatchSize)
  })

  it('advances batch state at sentinel end and prepares the next batch at sentinel start', async () => {
    const dag = createDag()
    const templateBranchId = buildBranchNodeId('task-1', 0)
    const secondBranchId = buildBranchNodeId('task-1', 1)
    dag.nodes.set(templateBranchId, {
      id: templateBranchId,
      block: {
        id: 'task-1',
        position: { x: 0, y: 0 },
        config: { tool: '', params: {} },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Task 1' },
        enabled: true,
      },
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        subflowId: 'parallel-1',
        subflowType: 'parallel',
        isParallelBranch: true,
        branchIndex: 0,
      },
    })
    const state = createState()
    const edgeManager = createEdgeManager()
    const orchestrator = new ParallelOrchestrator(dag, state, null, {}, edgeManager)
    const scope = {
      parallelId: 'parallel-1',
      totalBranches: 4,
      batchSize: 2,
      currentBatchStart: 0,
      currentBatchSize: 2,
      accumulatedOutputs: new Map<number, any[]>(),
      branchOutputs: new Map<number, any[]>([
        [0, [{ output: 'branch-0' }]],
        [1, [{ output: 'branch-1' }]],
      ]),
    }
    const ctx = createContext({
      parallelExecutions: new Map([['parallel-1', scope]]),
    })

    const result = await orchestrator.aggregateParallelResults(ctx, 'parallel-1')

    expect(result.allBranchesComplete).toBe(false)
    expect(scope.currentBatchStart).toBe(2)
    expect(scope.currentBatchSize).toBe(2)
    expect(ctx.parallelBlockMapping?.size ?? 0).toBe(0)

    orchestrator.prepareCurrentBatch(ctx, 'parallel-1')

    expect(ctx.parallelBlockMapping?.get(templateBranchId)).toMatchObject({
      originalBlockId: 'task-1',
      parallelId: 'parallel-1',
      iterationIndex: 2,
    })
    expect(ctx.parallelBlockMapping?.get(secondBranchId)).toMatchObject({
      originalBlockId: 'task-1',
      parallelId: 'parallel-1',
      iterationIndex: 3,
    })
    expect(state.deleteBlockState).toHaveBeenCalledWith(templateBranchId)
    expect(state.deleteBlockState).toHaveBeenCalledWith(secondBranchId)
    expect(edgeManager.clearDeactivatedEdgesForNodes).toHaveBeenCalledWith(
      new Set([templateBranchId, secondBranchId])
    )
  })

  it('resets only incoming batch branch state when scheduling later batches', async () => {
    const dag = createDag()
    const incomingBranchId = buildBranchNodeId('task-1', 0)
    const previousBranchId = buildBranchNodeId('task-1', 1)
    dag.nodes.set(incomingBranchId, {
      id: incomingBranchId,
      block: {
        id: 'task-1',
        position: { x: 0, y: 0 },
        config: { tool: '', params: {} },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Task 1' },
        enabled: true,
      },
      incomingEdges: new Set(),
      outgoingEdges: new Set(),
      metadata: {
        subflowId: 'parallel-1',
        subflowType: 'parallel',
        isParallelBranch: true,
        branchIndex: 0,
      },
    })
    dag.nodes.set(previousBranchId, {
      id: previousBranchId,
      block: {
        id: 'task-1',
        position: { x: 0, y: 0 },
        config: { tool: '', params: {} },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Task 1' },
        enabled: true,
      },
      incomingEdges: new Set(),
      outgoingEdges: new Set(),
      metadata: {
        subflowId: 'parallel-1',
        subflowType: 'parallel',
        isParallelBranch: true,
        branchIndex: 1,
      },
    })
    const state = createState()
    const orchestrator = new ParallelOrchestrator(dag, state, null, {})

    orchestrator.prepareCurrentBatch(
      createContext({
        parallelExecutions: new Map([
          [
            'parallel-1',
            {
              parallelId: 'parallel-1',
              totalBranches: 3,
              batchSize: 1,
              currentBatchStart: 2,
              currentBatchSize: 1,
              accumulatedOutputs: new Map([[1, [{ output: 'previous' }]]]),
              branchOutputs: new Map(),
            },
          ],
        ]),
      }),
      'parallel-1'
    )

    expect(state.deleteBlockState).toHaveBeenCalledWith(incomingBranchId)
    expect(state.deleteBlockState).not.toHaveBeenCalledWith(previousBranchId)
    expect(state.unmarkExecuted).toHaveBeenCalledWith(incomingBranchId)
    expect(state.unmarkExecuted).not.toHaveBeenCalledWith(previousBranchId)
  })

  it('marks expanded branch nodes dirty when running from a dirty parallel container', () => {
    const dag = createDag()
    const templateBranchId = buildBranchNodeId('task-1', 0)
    const secondBranchId = buildBranchNodeId('task-1', 1)
    dag.nodes.set(templateBranchId, {
      id: templateBranchId,
      block: {
        id: 'task-1',
        position: { x: 0, y: 0 },
        config: { tool: '', params: {} },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Task 1' },
        enabled: true,
      },
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        subflowId: 'parallel-1',
        subflowType: 'parallel',
        isParallelBranch: true,
        branchIndex: 0,
      },
    })
    const dirtySet = new Set(['parallel-1'])
    const orchestrator = new ParallelOrchestrator(dag, createState(), null, {})

    orchestrator.prepareCurrentBatch(
      createContext({
        runFromBlockContext: { startBlockId: 'parallel-1', dirtySet },
        parallelExecutions: new Map([
          [
            'parallel-1',
            {
              parallelId: 'parallel-1',
              totalBranches: 2,
              batchSize: 2,
              currentBatchStart: 0,
              currentBatchSize: 2,
              branchOutputs: new Map(),
            },
          ],
        ]),
      }),
      'parallel-1'
    )

    expect(dirtySet.has(templateBranchId)).toBe(true)
    expect(dirtySet.has(secondBranchId)).toBe(true)
  })

  it('marks cloned nested loop body nodes dirty for non-zero branches', () => {
    const dag = createDag()
    const parallelId = 'parallel-1'
    const loopId = 'loop-1'
    const taskId = 'task-1'
    const parallelStartId = buildParallelSentinelStartId(parallelId)
    const parallelEndId = buildParallelSentinelEndId(parallelId)
    const loopStartId = buildSentinelStartId(loopId)
    const loopEndId = buildSentinelEndId(loopId)

    dag.parallelConfigs.set(parallelId, {
      id: parallelId,
      nodes: [loopId],
      count: 2,
      parallelType: 'count',
    })
    dag.loopConfigs.set(loopId, {
      id: loopId,
      nodes: [taskId],
      loopType: 'for',
      iterations: 1,
    })
    dag.nodes.set(parallelStartId, createDagNode(parallelStartId))
    dag.nodes.set(parallelEndId, createDagNode(parallelEndId))
    dag.nodes.set(
      loopStartId,
      createDagNode(loopStartId, {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: loopId,
        subflowType: 'loop',
      })
    )
    dag.nodes.set(
      taskId,
      createDagNode(taskId, {
        isLoopNode: true,
        subflowId: loopId,
        subflowType: 'loop',
        originalBlockId: taskId,
      })
    )
    dag.nodes.set(
      loopEndId,
      createDagNode(loopEndId, {
        isSentinel: true,
        sentinelType: 'end',
        subflowId: loopId,
        subflowType: 'loop',
      })
    )
    dag.nodes.get(loopStartId)!.outgoingEdges.set(`${loopStartId}->${taskId}`, { target: taskId })
    dag.nodes.get(taskId)!.incomingEdges.add(loopStartId)
    dag.nodes.get(taskId)!.outgoingEdges.set(`${taskId}->${loopEndId}`, { target: loopEndId })
    dag.nodes.get(loopEndId)!.incomingEdges.add(taskId)

    const dirtySet = new Set([parallelId])
    const orchestrator = new ParallelOrchestrator(dag, createState(), null, {})
    orchestrator.prepareCurrentBatch(
      createContext({
        runFromBlockContext: { startBlockId: parallelId, dirtySet },
        parallelExecutions: new Map([
          [
            parallelId,
            {
              parallelId,
              totalBranches: 2,
              batchSize: 2,
              currentBatchStart: 0,
              currentBatchSize: 2,
              branchOutputs: new Map(),
            },
          ],
        ]),
      }),
      parallelId
    )

    expect([...dirtySet]).toContain(taskId)
    expect([...dirtySet].some((nodeId) => nodeId.startsWith(`${taskId}__clone`))).toBe(true)
  })

  it('compacts accumulated outputs before scheduling later batches', async () => {
    const dag = createDag()
    const templateBranchId = buildBranchNodeId('task-1', 0)
    dag.nodes.set(templateBranchId, {
      id: templateBranchId,
      block: {
        id: 'task-1',
        position: { x: 0, y: 0 },
        config: { tool: '', params: {} },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Task 1' },
        enabled: true,
      },
      incomingEdges: new Set(),
      outgoingEdges: new Set(),
      metadata: {
        subflowId: 'parallel-1',
        subflowType: 'parallel',
        isParallelBranch: true,
        branchIndex: 0,
      },
    })
    const orchestrator = new ParallelOrchestrator(dag, createState(), null, {})
    const previousOutputs = [{ output: 'previous' }]
    const incomingOutputs = [{ output: 'incoming' }]
    const compactedPrevious = [{ output: 'compacted-previous' }]
    const compactedIncoming = [{ output: 'compacted-incoming' }]
    mockCompactSubflowResults.mockResolvedValueOnce([compactedPrevious, compactedIncoming])
    const scope = {
      parallelId: 'parallel-1',
      totalBranches: 3,
      batchSize: 1,
      currentBatchStart: 0,
      currentBatchSize: 2,
      accumulatedOutputs: new Map([[0, previousOutputs]]),
      branchOutputs: new Map([[1, incomingOutputs]]),
    }
    const ctx = createContext({
      parallelExecutions: new Map([['parallel-1', scope]]),
    })

    const result = await orchestrator.aggregateParallelResults(ctx, 'parallel-1')

    expect(result).toMatchObject({ allBranchesComplete: false, completedBranches: 2 })
    expect(mockCompactSubflowResults).toHaveBeenCalledWith(
      [previousOutputs, incomingOutputs],
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        requireDurable: true,
      })
    )
    expect(scope.accumulatedOutputs.get(0)).toBe(compactedPrevious)
    expect(scope.accumulatedOutputs.get(1)).toBe(compactedIncoming)
  })
})
