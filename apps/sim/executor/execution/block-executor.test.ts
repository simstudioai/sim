/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { BlockType } from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { ExecutionState } from '@/executor/execution/state'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateBlockType: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

function createBlock(): SerializedBlock {
  return {
    id: 'function-block-1',
    metadata: { id: BlockType.FUNCTION, name: 'Function' },
    position: { x: 0, y: 0 },
    config: { tool: BlockType.FUNCTION, params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

function createContext(state: ExecutionState): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: state.getBlockStates(),
    blockLogs: [],
    metadata: { requestId: 'request-1', duration: 0 },
    environmentVariables: {},
    workflowVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    completedLoops: new Set(),
  } as ExecutionContext
}

function createNode(block: SerializedBlock): DAGNode {
  return {
    id: block.id,
    block,
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {},
  }
}

describe('BlockExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it('persists function output arrays as manifests in execution state', async () => {
    const block = createBlock()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const output = {
      result: Array.from({ length: 120_000 }, (_, index) => ({
        key: `SIM-${index}`,
        payload: 'x'.repeat(100),
      })),
    }
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => output,
    }
    const executor = new BlockExecutor(
      [handler],
      resolver,
      {
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        userId: 'user-1',
        metadata: {
          requestId: 'request-1',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          triggerType: 'manual',
          useDraftState: false,
          startTime: new Date().toISOString(),
        },
      },
      state
    )

    await executor.execute(createContext(state), createNode(block), block)

    const storedOutput = state.getBlockOutput(block.id)
    expect(isLargeArrayManifest(storedOutput?.result)).toBe(true)
    expect(storedOutput?.result).toMatchObject({
      __simLargeArrayManifest: true,
      kind: 'array',
      totalCount: output.result.length,
    })
  })

  it('persists stable outer-branch aliases for completed parallel branch outputs', async () => {
    const block = createBlock()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const output = { result: 'branch-2' }
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => output,
    }
    const executor = new BlockExecutor(
      [handler],
      resolver,
      {
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        userId: 'user-1',
        metadata: {
          requestId: 'request-1',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          triggerType: 'manual',
          useDraftState: false,
          startTime: new Date().toISOString(),
        },
      },
      state
    )
    const node = createNode(block)
    node.id = 'function-block-1₍0₎'
    node.metadata = {
      isParallelBranch: true,
      subflowId: 'parallel-1',
      subflowType: 'parallel',
      originalBlockId: block.id,
      branchIndex: 2,
    }

    await executor.execute(createContext(state), node, block)

    expect(state.getBlockOutput('function-block-1__obranch-2')).toEqual(output)
    expect(state.getBlockOutput('function-block-1₍2₎')).toEqual(output)
    expect(state.getBlockOutput('function-block-1₍0₎')).toEqual(output)
  })

  it('does not write global aliases for parallel branches inside cloned outer branches', async () => {
    const block = createBlock()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const output = { result: 'outer-2-inner-0' }
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => output,
    }
    const executor = new BlockExecutor(
      [handler],
      resolver,
      {
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        userId: 'user-1',
        metadata: {
          requestId: 'request-1',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          triggerType: 'manual',
          useDraftState: false,
          startTime: new Date().toISOString(),
        },
      },
      state
    )
    const node = createNode(block)
    node.id = 'function-block-1__cloneabc__obranch-2₍0₎'
    node.metadata = {
      isParallelBranch: true,
      subflowId: 'inner-parallel',
      subflowType: 'parallel',
      originalBlockId: block.id,
      branchIndex: 0,
    }

    await executor.execute(createContext(state), node, block)

    expect(state.getBlockOutput(node.id)).toEqual(output)
    expect(state.getBlockOutput('function-block-1__obranch-0')).toBeUndefined()
    expect(state.getBlockOutput('function-block-1₍0₎')).toBeUndefined()
  })

  it('does not let block completion callbacks overtake pending start callbacks', async () => {
    const block = createBlock()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const output = { result: 'done' }
    const execute = vi.fn(async () => {
      events.push('execute')
      return output
    })
    const handler: BlockHandler = {
      canHandle: () => true,
      execute,
    }

    const events: string[] = []
    let resolveStart!: () => void
    const startGate = new Promise<void>((resolve) => {
      resolveStart = resolve
    })
    const onBlockStart = vi.fn(async () => {
      events.push('start-called')
      await startGate
      events.push('start-done')
    })
    const onBlockComplete = vi.fn(async () => {
      events.push('complete')
    })

    const executor = new BlockExecutor(
      [handler],
      resolver,
      {
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        userId: 'user-1',
        metadata: {
          requestId: 'request-1',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          triggerType: 'manual',
          useDraftState: false,
          startTime: new Date().toISOString(),
        },
        onBlockStart,
        onBlockComplete,
      },
      state
    )

    const execution = executor.execute(createContext(state), createNode(block), block)

    expect(onBlockStart).toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(onBlockComplete).not.toHaveBeenCalled()

    resolveStart()

    await execution
    await vi.waitFor(() => {
      expect(onBlockComplete).toHaveBeenCalled()
    })
    expect(events).toEqual(['start-called', 'start-done', 'execute', 'complete'])
  })

  it('fires block completion callbacks for pausing blocks so clients receive pause output', async () => {
    const block = {
      ...createBlock(),
      id: 'hitl-block-1',
      metadata: { id: BlockType.HUMAN_IN_THE_LOOP, name: 'Human in the Loop' },
      config: { tool: BlockType.HUMAN_IN_THE_LOOP, params: {} },
    }
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const output = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'pause-context-1',
        blockId: block.id,
        response: { status: 'paused' },
        timestamp: new Date().toISOString(),
        pauseKind: 'human' as const,
      },
    }
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => output,
    }
    const onBlockStart = vi.fn(async () => {})
    const onBlockComplete = vi.fn(async () => {})

    const executor = new BlockExecutor(
      [handler],
      resolver,
      {
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        userId: 'user-1',
        metadata: {
          requestId: 'request-1',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          triggerType: 'manual',
          useDraftState: false,
          startTime: new Date().toISOString(),
        },
        onBlockStart,
        onBlockComplete,
      },
      state
    )

    await executor.execute(createContext(state), createNode(block), block)

    expect(onBlockStart).toHaveBeenCalled()
    expect(onBlockComplete).toHaveBeenCalledWith(
      block.id,
      'Human in the Loop',
      BlockType.HUMAN_IN_THE_LOOP,
      expect.objectContaining({
        output: expect.objectContaining({
          response: { status: 'paused' },
        }),
      }),
      undefined,
      undefined
    )
    expect(state.getBlockOutput(block.id)).toEqual(output)
  })
})
