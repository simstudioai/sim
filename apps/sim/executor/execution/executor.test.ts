import type { SessionPrincipal } from '@sim/auth/principal'
import { createSerializedBlock, createSerializedWorkflow } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeFileKeys, mergeLargeValueKeys } from '@/lib/execution/payloads/access-keys'
import { BlockType } from '@/executor/constants'
import type { DAGBuilder } from '@/executor/dag/builder'
import { DAGExecutor } from '@/executor/execution/executor'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import { RunFromBlockValidationError } from '@/executor/utils/run-from-block'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const { executed, gateChoice } = vi.hoisted(() => ({
  executed: [] as string[],
  gateChoice: { value: 'if' as 'if' | 'else' },
}))

vi.mock('@/executor/handlers/registry', () => ({
  createBlockHandlers: () => [
    {
      canHandle: () => true,
      execute: async (
        _ctx: unknown,
        block: { id: string; metadata?: { id?: string; name?: string } }
      ) => {
        executed.push(block.id)
        if (block.metadata?.id === 'condition') {
          return { selectedOption: `${block.metadata.name}-${gateChoice.value}` }
        }
        return { ok: true }
      },
    },
  ],
}))

/** Reaches the executor's private context factory, which every run's root context comes from. */
function createExecutionContext(executor: DAGExecutor, workflowId = 'wf-1'): ExecutionContext {
  return (
    executor as unknown as {
      createExecutionContext: (workflowId: string) => { context: ExecutionContext }
    }
  ).createExecutionContext(workflowId).context
}

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

  it('refuses a start block whose upstream never executed with a typed validation error', async () => {
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
    const executor = new DAGExecutor({ workflow })
    const sourceSnapshot: SerializableExecutionState = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    const error = await executor.executeFromBlock('wf', 'consumer', sourceSnapshot).catch((e) => e)

    expect(error).toBeInstanceOf(RunFromBlockValidationError)
    expect(error.message).toBe('Upstream dependency not executed: producer')
  })
})

describe('DAGExecutor resume DAG construction', () => {
  it('includes non-starter resume targets when a workflow has a disconnected starter', async () => {
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [
        createBlock('start-t2-v2', BlockType.STARTER),
        createBlock('webhook-start', 'generic_webhook'),
        createBlock('hitl', BlockType.HUMAN_IN_THE_LOOP),
        createBlock('generate-report', BlockType.FUNCTION),
      ],
      connections: [
        { source: 'webhook-start', target: 'hitl', sourceHandle: 'source' },
        { source: 'hitl', target: 'generate-report', sourceHandle: 'source' },
      ],
      loops: {},
      parallels: {},
    }
    let capturedDag: ReturnType<DAGBuilder['build']> | undefined
    const executor = new DAGExecutor({
      workflow,
      contextExtensions: {
        resumeFromSnapshot: true,
        remainingEdges: [{ source: 'hitl', target: 'generate-report', sourceHandle: 'source' }],
        dagIncomingEdges: { 'start-t2-v2': [] },
        snapshotState: {
          blockStates: {},
          executedBlocks: ['webhook-start', 'hitl'],
          blockLogs: [],
          decisions: { router: {}, condition: {} },
          completedLoops: [],
          activeExecutionPath: [],
        },
      },
    }) as unknown as DAGExecutor & {
      buildExecutionPipeline: (
        context: ExecutionContext,
        dag: ReturnType<DAGBuilder['build']>
      ) => { run: () => Promise<ExecutionResult> }
    }
    executor.buildExecutionPipeline = vi.fn((_context, dag) => {
      capturedDag = dag
      return {
        run: async (): Promise<ExecutionResult> => ({
          success: true,
          output: { ok: true },
          metadata: {},
        }),
      }
    })

    await executor.execute('wf')

    expect(capturedDag?.nodes.has('generate-report')).toBe(true)
    expect(capturedDag?.nodes.get('generate-report')?.incomingEdges.has('hitl')).toBe(true)
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
    return createExecutionContext(executor).metadata.useDraftState
  }

  it('honors explicit useDraftState=true even when isDeployedContext is true (table dispatcher)', () => {
    expect(
      buildMetadataUseDraftState({ metadataUseDraftState: true, isDeployedContext: true })
    ).toBe(true)
  })
})

describe('DAGExecutor run-scoped permission config cache', () => {
  it('seeds one cache per run that survives per-block context copies', () => {
    const executor = new DAGExecutor({
      workflow: { version: '1', blocks: [], connections: [] },
      contextExtensions: { workspaceId: 'ws-1' },
    })

    const context = createExecutionContext(executor)
    const blockContext = { ...context }

    expect(context.permissionConfigCache).toBeInstanceOf(Map)
    expect(blockContext.permissionConfigCache).toBe(context.permissionConfigCache)
  })
})

describe('DAGExecutor exact access key lists', () => {
  function createContext(contextExtensions: Record<string, unknown>): ExecutionContext {
    return createExecutionContext(
      new DAGExecutor({
        workflow: { version: '1', blocks: [], connections: [] },
        contextExtensions,
      })
    )
  }

  it('keeps keys a block records on its context copy for later blocks', () => {
    const context = createContext({})

    mergeLargeValueKeys({ ...context }, ['large-value-key'])
    mergeFileKeys({ ...context }, ['file-key'])

    expect(context.largeValueKeys).toEqual(['large-value-key'])
    expect(context.fileKeys).toEqual(['file-key'])
  })
})

describe('DAGExecutor run-from-block edge state', () => {
  const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

  /** Block ids double as their type for the special blocks; every other block is a function. */
  const BLOCK_TYPES: Record<string, string> = {
    start: BlockType.STARTER,
    gate: BlockType.CONDITION,
    loop: BlockType.LOOP,
    fanOut: BlockType.PARALLEL,
  }

  function workflow(
    connections: SerializedWorkflow['connections'],
    loops: SerializedWorkflow['loops'] = {},
    parallels: SerializedWorkflow['parallels'] = {}
  ): SerializedWorkflow {
    const ids = new Set(connections.flatMap((c) => [c.source, c.target]))
    const blocks = [...ids].map((id) =>
      createSerializedBlock({ id, name: id, type: BLOCK_TYPES[id] ?? BlockType.FUNCTION })
    )
    return { ...createSerializedWorkflow(blocks, connections), loops, parallels }
  }

  function createExecutor(wf: SerializedWorkflow, executionId: string): DAGExecutor {
    return new DAGExecutor({
      workflow: wf,
      contextExtensions: { workspaceId: 'ws', executionId, principal: PRINCIPAL },
    })
  }

  /** A full run with one gate decision, then a run-from-block seeded from that run's snapshot. */
  async function rerunFromBlock(
    wf: SerializedWorkflow,
    startBlockId: string,
    first: 'if' | 'else',
    second: 'if' | 'else'
  ): Promise<string[]> {
    gateChoice.value = first
    const run1 = await createExecutor(wf, 'exec-1').execute('wf')
    expect(run1.success).toBe(true)
    expect(run1.executionState).toBeDefined()

    executed.length = 0
    gateChoice.value = second
    const run2 = await createExecutor(wf, 'exec-2').executeFromBlock(
      'wf',
      startBlockId,
      run1.executionState!
    )
    expect(run2.success).toBe(true)
    return [...executed]
  }

  const exclusive = workflow([
    { source: 'start', target: 'prep' },
    { source: 'prep', target: 'gate' },
    { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
    { source: 'gate', target: 'noDoc', sourceHandle: 'condition-gate-else' },
  ])

  const diamond = workflow([
    { source: 'start', target: 'prep' },
    { source: 'prep', target: 'gate' },
    { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
    { source: 'gate', target: 'docPlan', sourceHandle: 'condition-gate-else' },
    { source: 'readDoc', target: 'docPlan' },
  ])

  const siblings = workflow([
    { source: 'start', target: 'a' },
    { source: 'start', target: 'b' },
    { source: 'a', target: 'join' },
    { source: 'b', target: 'join' },
  ])

  const looped = workflow(
    [
      { source: 'start', target: 'prep' },
      { source: 'prep', target: 'loop' },
      { source: 'loop', target: 'gate', sourceHandle: 'loop-start-source' },
      { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
      { source: 'gate', target: 'noDoc', sourceHandle: 'condition-gate-else' },
    ],
    { loop: { id: 'loop', nodes: ['gate', 'readDoc', 'noDoc'], iterations: 1, loopType: 'for' } }
  )

  beforeEach(() => {
    executed.length = 0
  })

  it.each([
    {
      title: 'does not run an unselected branch the source execution had activated',
      wf: exclusive,
      start: 'prep',
      first: 'if',
      second: 'else',
      expected: ['prep', 'gate', 'noDoc'],
    },
    {
      title: 'runs the branch the source execution had deactivated when it is selected',
      wf: exclusive,
      start: 'prep',
      first: 'else',
      second: 'if',
      expected: ['prep', 'gate', 'readDoc'],
    },
    {
      title: 'waits for the live input of a join the source execution had released early',
      wf: diamond,
      start: 'prep',
      first: 'else',
      second: 'if',
      expected: ['prep', 'gate', 'readDoc', 'docPlan'],
    },
    {
      title: 'still runs the join directly when its other input is deselected',
      wf: diamond,
      start: 'prep',
      first: 'if',
      second: 'else',
      expected: ['prep', 'gate', 'docPlan'],
    },
    {
      title: 'does not wait on a cached sibling input outside the re-run region',
      wf: siblings,
      start: 'a',
      first: 'if',
      second: 'if',
      expected: ['a', 'join'],
    },
    {
      title: 'does not run a stale branch inside a loop',
      wf: looped,
      start: 'prep',
      first: 'if',
      second: 'else',
      expected: ['prep', 'gate', 'noDoc'],
    },
  ] as const)('$title', async ({ wf, start, first, second, expected }) => {
    expect(await rerunFromBlock(wf, start, first, second)).toEqual(expected)
  })

  it('runs a join once after every re-run input completes', async () => {
    const fanIn = workflow([
      { source: 'start', target: 'prep' },
      { source: 'prep', target: 'a' },
      { source: 'prep', target: 'b' },
      { source: 'a', target: 'join' },
      { source: 'b', target: 'join' },
    ])
    const order = await rerunFromBlock(fanIn, 'prep', 'if', 'if')
    expect(order.filter((id) => id === 'join')).toHaveLength(1)
    expect(order.indexOf('join')).toBeGreaterThan(Math.max(order.indexOf('a'), order.indexOf('b')))
  })

  it('does not run a stale branch in any parallel branch copy', async () => {
    const parallel = workflow(
      [
        { source: 'start', target: 'prep' },
        { source: 'prep', target: 'fanOut' },
        { source: 'fanOut', target: 'gate', sourceHandle: 'parallel-start-source' },
        { source: 'gate', target: 'readDoc', sourceHandle: 'condition-gate-if' },
        { source: 'gate', target: 'noDoc', sourceHandle: 'condition-gate-else' },
      ],
      {},
      {
        fanOut: {
          id: 'fanOut',
          nodes: ['gate', 'readDoc', 'noDoc'],
          count: 3,
          parallelType: 'count',
        },
      }
    )
    const ids = (await rerunFromBlock(parallel, 'prep', 'if', 'else')).map(stripCloneSuffixes)
    expect(ids).not.toContain('readDoc')
    expect(ids.filter((id) => id === 'noDoc')).toHaveLength(3)
  })
})
