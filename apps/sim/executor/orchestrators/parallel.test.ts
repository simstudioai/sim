/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DAG } from '@/executor/dag/builder'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import { ParallelOrchestrator } from '@/executor/orchestrators/parallel'
import type { ExecutionContext } from '@/executor/types'
import { buildBranchNodeId } from '@/executor/utils/subflow-utils'

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

function createState(): BlockStateWriter {
  return {
    setBlockOutput: vi.fn(),
    setBlockState: vi.fn(),
    deleteBlockState: vi.fn(),
    unmarkExecuted: vi.fn(),
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

  it('awaits empty-subflow lifecycle callbacks before returning the empty scope', async () => {
    let releaseStart: (() => void) | undefined
    const onBlockStart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve
        })
    )
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

    const initializePromise = orchestrator.initializeParallelScope(ctx, 'parallel-1')
    await vi.waitFor(() => expect(onBlockStart).toHaveBeenCalledTimes(1))

    expect(onBlockComplete).not.toHaveBeenCalled()

    releaseStart?.()
    const scope = await initializePromise

    expect(onBlockComplete).toHaveBeenCalledTimes(1)
    expect(scope.isEmpty).toBe(true)
  })

  it('swallows helper callback failures on empty parallel paths', async () => {
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
      metadata: { parallelId: 'parallel-1', isParallelBranch: true, branchIndex: 0 },
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
      metadata: { parallelId: 'parallel-1', isParallelBranch: true, branchIndex: 1 },
    })
    const state = createState()
    const orchestrator = new ParallelOrchestrator(dag, state, null, {})

    await (
      orchestrator as unknown as {
        scheduleNextBatch(
          ctx: ExecutionContext,
          scope: NonNullable<ExecutionContext['parallelExecutions']> extends Map<
            string,
            infer Scope
          >
            ? Scope
            : never,
          nextBatchStart: number
        ): Promise<void>
      }
    ).scheduleNextBatch(
      createContext(),
      {
        parallelId: 'parallel-1',
        totalBranches: 3,
        batchSize: 1,
        currentBatchStart: 0,
        currentBatchSize: 2,
        accumulatedOutputs: new Map([[1, [{ output: 'previous' }]]]),
        branchOutputs: new Map(),
      },
      2
    )

    expect(state.deleteBlockState).toHaveBeenCalledWith(incomingBranchId)
    expect(state.deleteBlockState).not.toHaveBeenCalledWith(previousBranchId)
    expect(state.unmarkExecuted).toHaveBeenCalledWith(incomingBranchId)
    expect(state.unmarkExecuted).not.toHaveBeenCalledWith(previousBranchId)
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
      metadata: { parallelId: 'parallel-1', isParallelBranch: true, branchIndex: 0 },
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
