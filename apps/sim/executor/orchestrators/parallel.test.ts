import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { BlockStateController, ContextExtensions } from '@/executor/execution/types'
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

function createState(): BlockStateController {
  return {
    getBlockState: vi.fn(),
    getBlockOutput: vi.fn(),
    hasExecuted: vi.fn(() => false),
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
})
