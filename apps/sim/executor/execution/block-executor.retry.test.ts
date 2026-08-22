/**
 * @vitest-environment node
 *
 * Retry wraps only the handler invocation, so a replay cannot duplicate output the
 * client has already seen and cannot re-run the deterministic post-processing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType, EDGE } from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { ExecutionState } from '@/executor/execution/state'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateBlockType: vi.fn(),
}))

function createBlock(retry?: SerializedBlock['retry'], blockType = BlockType.FUNCTION) {
  return {
    id: 'block-1',
    metadata: { id: blockType, name: 'Post' },
    position: { x: 0, y: 0 },
    config: { tool: blockType, params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
    ...(retry ? { retry } : {}),
  } as SerializedBlock
}

function createContext(state: ExecutionState, abortSignal?: AbortSignal): ExecutionContext {
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
    abortSignal,
  } as unknown as ExecutionContext
}

function createNode(block: SerializedBlock, withErrorPort = false): DAGNode {
  return {
    id: block.id,
    block,
    incomingEdges: new Set(),
    outgoingEdges: withErrorPort
      ? new Map([['edge-1', { sourceHandle: EDGE.ERROR, target: 'downstream' }]])
      : new Map(),
    metadata: {},
  } as unknown as DAGNode
}

function buildExecutor(block: SerializedBlock, handler: BlockHandler, state: ExecutionState) {
  const workflow: SerializedWorkflow = {
    version: '1',
    blocks: [block],
    connections: [],
    loops: {},
    parallels: {},
  }
  return new BlockExecutor(
    [handler],
    new VariableResolver(workflow, {}, state),
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
}

const enabled = { enabled: true as const, maxTries: 3, waitBetweenTriesMs: 0 }

describe('BlockExecutor retry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs a block with no policy exactly once, as every existing workflow does', async () => {
    const block = createBlock()
    const execute = vi.fn().mockRejectedValue(new Error('boom'))
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(ctx.blockLogs[0]?.tries).toBeUndefined()
  })

  it('runs a block whose policy is switched off exactly once', async () => {
    const block = createBlock({ enabled: false, maxTries: 5, waitBetweenTriesMs: 0 })
    const execute = vi.fn().mockRejectedValue(new Error('boom'))
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(createContext(state), createNode(block), block)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('replays any failure and succeeds on a later try', async () => {
    const block = createBlock(enabled)
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('Internal server error'))
      .mockResolvedValueOnce({ ok: true })
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    const output = await executor.execute(ctx, createNode(block), block)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(output).toMatchObject({ ok: true })
    expect(ctx.blockLogs[0]?.success).toBe(true)
    expect(ctx.blockLogs[0]?.tries).toBe(2)
  })

  it('stops at maxTries and rethrows the final error unchanged', async () => {
    const block = createBlock(enabled)
    const failure = new Error('still failing')
    const execute = vi.fn().mockRejectedValue(failure)
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow('still failing')
    expect(execute).toHaveBeenCalledTimes(3)
    expect(ctx.blockLogs[0]?.tries).toBe(3)
  })

  it('routes to the error port only after the tries are spent', async () => {
    const block = createBlock(enabled)
    const execute = vi.fn().mockRejectedValue(new Error('down'))
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    const output = await executor.execute(ctx, createNode(block, true), block)

    expect(execute).toHaveBeenCalledTimes(3)
    expect(ctx.blockLogs[0]?.errorHandled).toBe(true)
    expect(output).toMatchObject({ error: expect.stringContaining('down') })
  })

  it('does not start another try once the run is cancelled', async () => {
    const controller = new AbortController()
    const block = createBlock({ enabled: true, maxTries: 5, waitBetweenTriesMs: 0 })
    const execute = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('transport'))
    })
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(
      executor.execute(createContext(state, controller.signal), createNode(block), block)
    ).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('never replays a deliberate stop', async () => {
    const block = createBlock({ enabled: true, maxTries: 5, waitBetweenTriesMs: 0 })
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const execute = vi.fn().mockRejectedValue(abort)
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(createContext(state), createNode(block), block)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('waits between tries', async () => {
    const block = createBlock({ enabled: true, maxTries: 2, waitBetweenTriesMs: 60 })
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ ok: true })
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    const startedAt = Date.now()
    await executor.execute(createContext(state), createNode(block), block)

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
