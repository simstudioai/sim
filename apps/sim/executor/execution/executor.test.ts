/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { DAGBuilder } from '@/executor/dag/builder'
import { DAGExecutor } from '@/executor/execution/executor'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import { buildSentinelStartId } from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

function createExecutor(): DAGExecutor {
  return new DAGExecutor({
    workflow: {
      version: '1',
      blocks: [],
      connections: [],
    },
  })
}

function createBlock(id: string, metadataId: string): SerializedBlock {
  return {
    id,
    position: { x: 0, y: 0 },
    config: { tool: 'noop', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: metadataId, name: id },
    enabled: true,
  }
}

describe('DAGExecutor restored cloned subflow registration', () => {
  it('registers restored cloned subflows under their parent parallel branch', () => {
    const executor = createExecutor() as unknown as {
      registerRestoredClonedSubflows: (
        parentMap: Map<
          string,
          { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
        >,
        clonedSubflows: Array<{
          originalId: string
          clonedId: string
          outerBranchIndex: number
          parentParallelId: string
        }>
      ) => void
    }
    const parentMap = new Map<
      string,
      { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
    >([['nested-loop', { parentId: 'parent-parallel', parentType: 'parallel' }]])

    executor.registerRestoredClonedSubflows(parentMap, [
      {
        originalId: 'nested-loop',
        clonedId: 'nested-loop__obranch-2',
        outerBranchIndex: 2,
        parentParallelId: 'parent-parallel',
      },
    ])

    expect(parentMap.get('nested-loop__obranch-2')).toEqual({
      parentId: 'parent-parallel',
      parentType: 'parallel',
      branchIndex: 2,
    })
  })

  it('preserves cloned nested parent relationships within the same restored branch', () => {
    const executor = createExecutor() as unknown as {
      registerRestoredClonedSubflows: (
        parentMap: Map<
          string,
          { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
        >,
        clonedSubflows: Array<{
          originalId: string
          clonedId: string
          outerBranchIndex: number
          parentParallelId: string
        }>
      ) => void
    }
    const parentMap = new Map<
      string,
      { parentId: string; parentType: 'loop' | 'parallel'; branchIndex?: number }
    >([
      ['middle-loop', { parentId: 'parent-parallel', parentType: 'parallel' }],
      ['inner-parallel', { parentId: 'middle-loop', parentType: 'loop' }],
    ])

    executor.registerRestoredClonedSubflows(parentMap, [
      {
        originalId: 'middle-loop',
        clonedId: 'middle-loop__obranch-2',
        outerBranchIndex: 2,
        parentParallelId: 'parent-parallel',
      },
      {
        originalId: 'inner-parallel',
        clonedId: 'inner-parallel__obranch-2',
        outerBranchIndex: 2,
        parentParallelId: 'parent-parallel',
      },
    ])

    expect(parentMap.get('inner-parallel__obranch-2')).toEqual({
      parentId: 'middle-loop__obranch-2',
      parentType: 'loop',
      branchIndex: 0,
    })
  })

  it('restores snapshot parallel batches with later global branch indexes', () => {
    const parallelId = 'parallel-1'
    const loopId = 'loop-1'
    const taskId = 'task-1'
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock(parallelId, BlockType.PARALLEL),
        createBlock(loopId, BlockType.LOOP),
        createBlock(taskId, BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: parallelId },
        { source: parallelId, target: loopId, sourceHandle: 'parallel-start-source' },
        { source: loopId, target: taskId, sourceHandle: 'loop-start-source' },
      ],
      loops: {
        [loopId]: {
          id: loopId,
          nodes: [taskId],
          iterations: 1,
          loopType: 'for',
        },
      },
      parallels: {
        [parallelId]: {
          id: parallelId,
          nodes: [loopId],
          count: 4,
          parallelType: 'count',
        },
      },
    }
    const dag = new DAGBuilder().build(workflow)
    const executor = new DAGExecutor({ workflow }) as unknown as {
      restoreSnapshotParallelBatches: (
        dag: ReturnType<DAGBuilder['build']>,
        snapshotState?: SerializableExecutionState
      ) => Array<{
        originalId: string
        clonedId: string
        outerBranchIndex: number
        parentParallelId: string
      }>
    }

    const restoredClones = executor.restoreSnapshotParallelBatches(dag, {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
      parallelExecutions: {
        [parallelId]: {
          currentBatchStart: 2,
          currentBatchSize: 1,
          totalBranches: 4,
          items: ['zero', 'one', 'two', 'three'],
        },
      },
    })

    expect(dag.nodes.has(buildSentinelStartId(`${loopId}__obranch-2`))).toBe(true)
    expect(restoredClones).toContainEqual(
      expect.objectContaining({
        originalId: loopId,
        clonedId: `${loopId}__obranch-2`,
        outerBranchIndex: 2,
        parentParallelId: parallelId,
      })
    )
  })
})

describe('DAGExecutor run-from-block snapshot metadata', () => {
  it('preserves reachable large value and file keys in run-from-block metadata', async () => {
    const reachableLargeValue = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEF123456',
      kind: 'object',
      size: 1024,
      key: 'execution/ws/wf/exec/large-value-lv_ABCDEF123456.json',
    }
    const unreachableLargeValue = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ZYXWVU654321',
      kind: 'object',
      size: 1024,
      key: 'execution/ws/wf/exec/large-value-lv_ZYXWVU654321.json',
    }
    const reachableFile = {
      id: 'file-1',
      name: 'reachable.txt',
      url: '/api/files/serve/reachable',
      size: 10,
      type: 'text/plain',
      key: 'execution/ws/wf/exec/reachable.txt',
    }
    const unreachableFile = {
      id: 'file-2',
      name: 'unreachable.txt',
      url: '/api/files/serve/unreachable',
      size: 10,
      type: 'text/plain',
      key: 'execution/ws/wf/exec/unreachable.txt',
    }
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock('producer', BlockType.FUNCTION),
        createBlock('consumer', BlockType.FUNCTION),
        createBlock('unreachable', BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: 'producer' },
        { source: 'producer', target: 'consumer' },
      ],
      loops: {},
      parallels: {},
    }
    const executor = new DAGExecutor({
      workflow,
      contextExtensions: {
        workspaceId: 'ws',
        executionId: 'exec',
        largeValueKeys: ['existing-large-key'],
        fileKeys: ['existing-file-key'],
      },
    }) as unknown as DAGExecutor & {
      buildExecutionPipeline: (context: ExecutionContext) => { run: () => Promise<ExecutionResult> }
    }
    const run = vi.fn(async (): Promise<ExecutionResult> => {
      return {
        success: true,
        output: { ok: true },
        metadata: {} as ExecutionResult['metadata'],
      }
    })
    executor.buildExecutionPipeline = vi.fn(() => ({ run }))
    const sourceSnapshot: SerializableExecutionState = {
      blockStates: {
        producer: { output: { reachableLargeValue, reachableFile } },
        consumer: { output: { previous: true } },
        unreachable: { output: { unreachableLargeValue, unreachableFile } },
      },
      executedBlocks: ['producer', 'consumer', 'unreachable'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    const result = await executor.executeFromBlock('wf', 'consumer', sourceSnapshot)

    expect(result.metadata?.largeValueKeys).toEqual(['existing-large-key', reachableLargeValue.key])
    expect(result.metadata?.fileKeys).toEqual(['existing-file-key', reachableFile.key])
    expect(result.metadata?.largeValueKeys).not.toContain(unreachableLargeValue.key)
    expect(result.metadata?.fileKeys).not.toContain(unreachableFile.key)
  })

  it('preserves reachable stable branch aliases in run-from-block snapshots', async () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start', BlockType.STARTER),
        createBlock('producer', BlockType.FUNCTION),
        createBlock('consumer', BlockType.FUNCTION),
      ],
      connections: [
        { source: 'start', target: 'producer' },
        { source: 'producer', target: 'consumer' },
      ],
      loops: {},
      parallels: {},
    }
    let capturedContext: ExecutionContext | undefined
    const executor = new DAGExecutor({ workflow }) as unknown as DAGExecutor & {
      buildExecutionPipeline: (context: ExecutionContext) => { run: () => Promise<ExecutionResult> }
    }
    executor.buildExecutionPipeline = vi.fn((context: ExecutionContext) => {
      capturedContext = context
      return {
        run: async (): Promise<ExecutionResult> => ({
          success: true,
          output: { ok: true },
          metadata: {},
        }),
      }
    })
    const sourceSnapshot: SerializableExecutionState = {
      blockStates: {
        producer: { output: { result: 'latest-local-batch' } },
        'producer__obranch-0': { output: { result: 'global-branch-0' } },
        'unreachable__obranch-0': { output: { result: 'unreachable' } },
        consumer: { output: { previous: true } },
      },
      executedBlocks: ['producer', 'producer__obranch-0', 'unreachable__obranch-0', 'consumer'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    await executor.executeFromBlock('wf', 'consumer', sourceSnapshot)

    expect(capturedContext?.blockStates.get('producer__obranch-0')?.output).toEqual({
      result: 'global-branch-0',
    })
    expect(capturedContext?.blockStates.has('unreachable__obranch-0')).toBe(false)
  })
})

describe('DAGExecutor createExecutionContext useDraftState', () => {
  function buildMetadataUseDraftState(opts: {
    metadataUseDraftState?: boolean
    isDeployedContext?: boolean
  }): boolean | undefined {
    const executor = new DAGExecutor({
      workflow: { version: '1', blocks: [], connections: [] },
      contextExtensions: {
        workspaceId: 'ws-1',
        isDeployedContext: opts.isDeployedContext,
        metadata:
          opts.metadataUseDraftState === undefined
            ? undefined
            : ({ useDraftState: opts.metadataUseDraftState } as ExecutionContext['metadata']),
      },
    })
    const { context } = (
      executor as unknown as {
        createExecutionContext: (workflowId: string) => { context: ExecutionContext }
      }
    ).createExecutionContext('wf-1')
    return context.metadata.useDraftState
  }

  it('honors explicit useDraftState=true even when isDeployedContext is true (table dispatcher)', () => {
    expect(
      buildMetadataUseDraftState({ metadataUseDraftState: true, isDeployedContext: true })
    ).toBe(true)
  })

  it('honors explicit useDraftState=false even when isDeployedContext is false', () => {
    expect(
      buildMetadataUseDraftState({ metadataUseDraftState: false, isDeployedContext: false })
    ).toBe(false)
  })

  it('falls back to the isDeployedContext heuristic when useDraftState is not provided', () => {
    expect(buildMetadataUseDraftState({ isDeployedContext: true })).toBe(false)
    expect(buildMetadataUseDraftState({ isDeployedContext: false })).toBe(true)
  })
})
