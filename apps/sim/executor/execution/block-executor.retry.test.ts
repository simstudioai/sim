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

function createBlock(retry?: SerializedBlock['retry']): SerializedBlock {
  return {
    id: 'slack-block-1',
    metadata: { id: BlockType.FUNCTION, name: 'Post' },
    position: { x: 0, y: 0 },
    config: { tool: BlockType.FUNCTION, params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
    ...(retry ? { retry } : {}),
  }
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
  } as ExecutionContext
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

/** Bun's dropped-connection failure, the case that motivated this. */
function socketClosed() {
  return new Error('The socket connection was closed unexpectedly.')
}

describe('BlockExecutor retry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not retry when the builder has not opted in', async () => {
    const block = createBlock()
    const execute = vi.fn().mockRejectedValue(socketClosed())
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(createContext(state), createNode(block), block)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('replays a transient failure and succeeds on a later attempt', async () => {
    const block = createBlock({ maxAttempts: 3, waitMs: 0 })
    const execute = vi
      .fn()
      .mockRejectedValueOnce(socketClosed())
      .mockResolvedValueOnce({ ok: true })
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    const output = await executor.execute(ctx, createNode(block), block)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(output).toMatchObject({ ok: true })
    expect(ctx.blockLogs[0]?.success).toBe(true)
    expect(ctx.blockLogs[0]?.attempts).toBe(2)
  })

  it('stops at the configured attempt ceiling', async () => {
    const block = createBlock({ maxAttempts: 3, waitMs: 0 })
    const execute = vi.fn().mockRejectedValue(socketClosed())
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(ctx.blockLogs[0]?.attempts).toBe(3)
  })

  /** A permanent failure must not spend the budget re-confirming itself. */
  it('does not replay a non-transient failure', async () => {
    const block = createBlock({ maxAttempts: 5, waitMs: 0 })
    const execute = vi.fn().mockRejectedValue(new Error('Invalid channel id'))
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(executor.execute(createContext(state), createNode(block), block)).rejects.toThrow(
      'Invalid channel id'
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  /** A run cancelled mid-flight must not start another attempt. */
  it('stops replaying once the run is cancelled', async () => {
    const block = createBlock({ maxAttempts: 5, waitMs: 0 })
    const controller = new AbortController()
    const execute = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw socketClosed()
    })
    const state = new ExecutionState()
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    await expect(
      executor.execute(createContext(state, controller.signal), createNode(block), block)
    ).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  /**
   * Retry and the error port compose: the port only sees the failure once the
   * attempt budget is spent, and the block still returns an error output rather
   * than throwing.
   */
  it('hands an exhausted retry to the error port instead of throwing', async () => {
    const block = createBlock({ maxAttempts: 2, waitMs: 0 })
    const execute = vi.fn().mockRejectedValue(socketClosed())
    const state = new ExecutionState()
    const ctx = createContext(state)
    const executor = buildExecutor(block, { canHandle: () => true, execute }, state)

    const output = await executor.execute(ctx, createNode(block, true), block)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(output.error).toContain('socket connection was closed')
    expect(ctx.blockLogs[0]?.errorHandled).toBe(true)
  })
})
