/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { projectTraceSpansForSecrets } from '@/lib/logs/execution/trace-secret-projection'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { BlockType, EDGE } from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { ExecutionState } from '@/executor/execution/state'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const blockExecutorLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'BlockExecutor'
)
const blockExecutorBaseLogger =
  loggerMock.createLogger.mock.results[blockExecutorLoggerCallIndex]?.value
if (!blockExecutorBaseLogger) throw new Error('BlockExecutor logger mock was not initialized')

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

vi.mock('@/lib/logs/execution/pii-redaction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logs/execution/pii-redaction')>()
  return {
    ...actual,
    redactObjectStrings: vi.fn(actual.redactObjectStrings),
  }
})

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

  it('carries complete encrypted candidates through large-output compaction', async () => {
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
    const onBlockComplete = vi.fn(async () => {})
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext) => {
        blockContext.resolvedSecretTraceRegistry?.recordResolved('API_KEY', 'secret-value')
        return {
          result: {
            huge: 'p'.repeat(9 * 1024 * 1024),
            public: 'ok',
            secret: 'secret-value',
          },
        }
      },
    }
    const executor = new BlockExecutor([handler], resolver, { onBlockComplete }, state)
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = registry

    await executor.execute(ctx, createNode(block), block)
    await vi.waitFor(() => expect(onBlockComplete).toHaveBeenCalledOnce())

    const storedOutput = state.getBlockOutput(block.id)
    const storedResult = storedOutput?.result as Record<string, unknown>
    expect(isLargeValueRef(storedResult.huge)).toBe(true)
    expect(storedResult.public).toBe('ok')
    expect(storedResult.secret).toBe('secret-value')

    const expectedProvenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance).toEqual(expectedProvenance)
    expect(onBlockComplete.mock.calls[0]?.[3]?.resolvedSecretTraceProvenance).toEqual(
      expectedProvenance
    )
    expect(onBlockComplete.mock.calls[0]?.[3]?.displayResolvedSecretTraceProvenance).toEqual(
      expectedProvenance
    )
    expect(JSON.stringify(expectedProvenance)).not.toContain('secret-value')
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

  it('projects lifecycle callback diagnostics without changing block execution', async () => {
    const secret = 'lifecycle-secret-7f3a91'
    const startError = new Error('start failed __var_API_KEY')
    const completionError = new Error(`completion failed ${secret} __sim_code_6_binding_0`)
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
    const output = { result: `raw ${secret}` }
    const executor = new BlockExecutor(
      [
        {
          canHandle: () => true,
          execute: async (blockContext) => {
            blockContext.resolvedSecretTraceRegistry?.recordResolved('API_KEY', secret)
            return output
          },
        },
      ],
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
        onBlockStart: async () => {
          throw startError
        },
        onBlockComplete: async () => {
          throw completionError
        },
      },
      state
    )
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-api-key' },
    ])

    await expect(executor.execute(ctx, createNode(block), block)).resolves.toEqual(output)
    expect(state.getBlockOutput(block.id)).toEqual(output)

    const executionLogger = blockExecutorBaseLogger.withMetadata.mock.results.at(-1)?.value
    expect(executionLogger).toBeDefined()
    await vi.waitFor(() => {
      expect(executionLogger?.warn).toHaveBeenCalledWith(
        'Block completion callback failed',
        expect.objectContaining({
          blockId: block.id,
          blockType: BlockType.FUNCTION,
          error: 'completion failed {{API_KEY}} [RUNTIME_BINDING]',
        })
      )
    })
    expect(executionLogger?.warn).toHaveBeenCalledWith(
      'Block start callback failed',
      expect.objectContaining({
        blockId: block.id,
        blockType: BlockType.FUNCTION,
        error: 'start failed [REDACTED_SECRET]',
      })
    )
    const loggerPayload = JSON.stringify(executionLogger?.warn.mock.calls)
    expect(loggerPayload).toContain('{{API_KEY}}')
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(startError.message).toContain('__var_API_KEY')
    expect(completionError.message).toContain(secret)
  })

  it('attaches encrypted provenance filtered to the exact lifecycle output', async () => {
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
    const onBlockComplete = vi.fn(async () => {})
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    const executor = new BlockExecutor(
      [
        {
          canHandle: () => true,
          execute: async (blockContext) => {
            blockContext.resolvedSecretTraceRegistry?.recordResolved('API_KEY', 'secret-value')
            return { result: 'secret-value', public: 'ok' }
          },
        },
      ],
      resolver,
      { onBlockComplete },
      state
    )
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = registry

    await executor.execute(ctx, createNode(block), block)
    await vi.waitFor(() => expect(onBlockComplete).toHaveBeenCalledOnce())

    expect(onBlockComplete.mock.calls[0]?.[3]?.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('does not attribute a sibling public value to another block secret', async () => {
    const secretBlock = createBlock()
    secretBlock.id = 'secret-block'
    const publicBlock = createBlock()
    publicBlock.id = 'public-block'
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [secretBlock, publicBlock],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const onBlockComplete = vi.fn(async () => {})
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SHORT_SECRET', plaintext: 'TestValue', encryptedValue: 'encrypted-test' },
    ])
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, block) => {
        if (block.id === secretBlock.id) {
          blockContext.resolvedSecretTraceRegistry?.recordResolved('SHORT_SECRET', 'TestValue')
        }
        return { result: 'TestValue' }
      },
    }
    const executor = new BlockExecutor([handler], resolver, { onBlockComplete }, state)
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = registry

    await executor.execute(ctx, createNode(secretBlock), secretBlock)
    await executor.execute(ctx, createNode(publicBlock), publicBlock)
    await vi.waitFor(() => expect(onBlockComplete).toHaveBeenCalledTimes(2))

    expect(state.getBlockState(secretBlock.id)?.resolvedSecretTraceProvenance?.entries).toEqual([
      { name: 'SHORT_SECRET', encryptedValue: 'encrypted-test' },
    ])
    expect(state.getBlockState(publicBlock.id)?.resolvedSecretTraceProvenance?.entries).toEqual([])
    expect(onBlockComplete.mock.calls[1]?.[3]?.resolvedSecretTraceProvenance?.entries).toEqual([])
  })

  it('uses a handler-narrowed registry for output provenance and parent commit', async () => {
    const block: SerializedBlock = {
      ...createBlock(),
      metadata: { id: BlockType.MOTHERSHIP, name: 'Sim Chat' },
      config: { tool: BlockType.MOTHERSHIP, params: { selector: 'x' } },
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
    const onBlockComplete = vi.fn(async () => {})
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PRIVATE_SELECTOR', plaintext: 'x', encryptedValue: 'encrypted-selector' },
    ])
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, _block, inputs) => {
        const callRegistry = blockContext.resolvedSecretTraceRegistry!
        callRegistry.recordResolvedAtInputPath('PRIVATE_SELECTOR', 'x', ['selector'])
        callRegistry.recordResolvedInputProjection(['selector'], 'x', '{{PRIVATE_SELECTOR}}')
        inputs.selector = '{{PRIVATE_SELECTOR}}'
        blockContext.resolvedSecretTraceRegistry = callRegistry.forkForInputPaths([])
        return { result: 'Box' }
      },
    }
    const executor = new BlockExecutor([handler], resolver, { onBlockComplete }, state)
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = registry

    await expect(executor.execute(ctx, createNode(block), block)).resolves.toEqual({
      result: 'Box',
    })
    await vi.waitFor(() => expect(onBlockComplete).toHaveBeenCalledOnce())

    expect(state.getBlockOutput(block.id)).toEqual({ result: 'Box' })
    expect(ctx.blockLogs[0]?.input).toEqual({ selector: '{{PRIVATE_SELECTOR}}' })
    expect(onBlockComplete.mock.calls[0]?.[3]?.input).toEqual({
      selector: '{{PRIVATE_SELECTOR}}',
    })
    expect(onBlockComplete.mock.calls[0]?.[3]?.output).toEqual({ result: 'Box' })
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance?.entries).toEqual([])
    expect(
      onBlockComplete.mock.calls[0]?.[3]?.displayResolvedSecretTraceProvenance?.entries
    ).toEqual([])
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('uses a handler-narrowed registry when execution fails after private input settlement', async () => {
    const block: SerializedBlock = {
      ...createBlock(),
      metadata: { id: BlockType.MOTHERSHIP, name: 'Sim Chat' },
      config: { tool: BlockType.MOTHERSHIP, params: { selector: 'x' } },
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
    const onBlockComplete = vi.fn(async () => {})
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PRIVATE_SELECTOR', plaintext: 'x', encryptedValue: 'encrypted-selector' },
    ])
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, _block, inputs) => {
        const callRegistry = blockContext.resolvedSecretTraceRegistry!
        callRegistry.recordResolvedAtInputPath('PRIVATE_SELECTOR', 'x', ['selector'])
        callRegistry.recordResolvedInputProjection(['selector'], 'x', '{{PRIVATE_SELECTOR}}')
        inputs.selector = '{{PRIVATE_SELECTOR}}'
        blockContext.resolvedSecretTraceRegistry = callRegistry.forkForInputPaths([])
        throw new Error('Provider request preparation failed')
      },
    }
    const executor = new BlockExecutor([handler], resolver, { onBlockComplete }, state)
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = registry

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(
      'Provider request preparation failed'
    )
    await vi.waitFor(() => expect(onBlockComplete).toHaveBeenCalledOnce())

    expect(state.getBlockOutput(block.id)).toEqual({
      error: 'Provider request preparation failed',
    })
    expect(ctx.blockLogs[0]?.input).toEqual({ selector: '{{PRIVATE_SELECTOR}}' })
    expect(onBlockComplete.mock.calls[0]?.[3]?.input).toEqual({
      selector: '{{PRIVATE_SELECTOR}}',
    })
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance?.entries).toEqual([])
    expect(
      onBlockComplete.mock.calls[0]?.[3]?.displayResolvedSecretTraceProvenance?.entries
    ).toEqual([])
    expect(registry.getActiveMatches()).toEqual([])
    expect(JSON.stringify(ctx.blockLogs)).not.toContain('"x"')
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

  it('does not soft-succeed non-agent blocks on user AbortError', async () => {
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
    const abortController = new AbortController()
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => {
        abortController.abort('user')
        throw new DOMException('The operation was aborted.', 'AbortError')
      },
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
    const ctx = createContext(state)
    ctx.abortSignal = abortController.signal

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(/abort/i)

    const output = state.getBlockOutput(block.id)
    expect(output?.error).toBeTruthy()
    expect(output).not.toEqual({ content: '' })
  })

  it('keeps Sim Chat secret policy in runtime inputs and out of trace inputs', async () => {
    const block = createBlock()
    block.id = 'mothership-block-1'
    block.metadata = { id: BlockType.MOTHERSHIP, name: 'Sim Chat' }
    block.config = {
      tool: BlockType.MOTHERSHIP,
      params: {
        prompt: 'Run the task',
        secretScope: 'selected',
        mountedSecrets: ['OPENAI_API_KEY'],
      },
    }
    block.privateInputIds = ['secretScope', 'mountedSecrets']
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (_ctx, _block, inputs) => {
        expect(inputs).toMatchObject({
          prompt: 'Run the task',
          secretScope: 'selected',
          mountedSecrets: ['OPENAI_API_KEY'],
        })
        return { content: 'done' }
      },
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
    const ctx = createContext(state)

    await executor.execute(ctx, createNode(block), block)

    expect(ctx.blockLogs[0]?.input).toEqual({ prompt: 'Run the task' })
    const { traceSpans } = buildTraceSpans({
      success: true,
      output: { content: 'done' },
      logs: ctx.blockLogs,
    })
    expect(traceSpans[0]?.input).toEqual({ prompt: 'Run the task' })
  })

  it('preserves Function secret placeholders until the execution boundary', async () => {
    const secret = 'function-secret-literal-7f3a91'
    const block = createBlock()
    block.metadata.name = 'Function 1'
    block.config.params = {
      code: 'return {{OPENAI_API_KEY}}',
      language: 'javascript',
    }
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'OPENAI_API_KEY',
        plaintext: secret,
        encryptedValue: 'encrypted-openai-api-key',
      },
    ])
    const resolver = new VariableResolver(workflow, {}, state)
    const syntaxError =
      'Syntax Error: Line 1: `return {{OPENAI_API_KEY}}` - Invalid or unexpected token'
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (_ctx, _block, inputs) => {
        expect(inputs.code).toBe('return {{OPENAI_API_KEY}}')
        throw new Error(syntaxError)
      },
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
    const ctx = createContext(state)
    ctx.environmentVariables = { OPENAI_API_KEY: secret }
    ctx.resolvedSecretTraceRegistry = registry

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(
      `Function 1: ${syntaxError}`
    )

    expect(registry.getActiveMatches()).toEqual([])
    expect(state.getBlockOutput(block.id)).toEqual({ error: syntaxError })
    expect(ctx.blockLogs[0]).toMatchObject({
      input: { code: 'return {{OPENAI_API_KEY}}' },
      output: { error: syntaxError },
      error: syntaxError,
    })

    const rawLogs = structuredClone(ctx.blockLogs)
    const { traceSpans: rawTraceSpans } = buildTraceSpans({
      success: false,
      output: { error: syntaxError },
      error: `Function 1: ${syntaxError}`,
      logs: ctx.blockLogs,
    })
    const rawTraceSnapshot = structuredClone(rawTraceSpans)
    const projectedTraceSpans = await projectTraceSpansForSecrets(rawTraceSpans, {
      registry,
      store: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
      },
    })

    expect(ctx.blockLogs).toEqual(rawLogs)
    expect(rawTraceSpans).toEqual(rawTraceSnapshot)
    expect(projectedTraceSpans).toEqual([
      expect.objectContaining({
        name: 'Function 1',
        input: expect.objectContaining({ code: 'return {{OPENAI_API_KEY}}' }),
        output: {
          error: 'Syntax Error: Line 1: `return {{OPENAI_API_KEY}}` - Invalid or unexpected token',
        },
      }),
    ])
    expect(JSON.stringify(projectedTraceSpans)).not.toContain(secret)
  })

  it('keeps raw error-port output while projecting operational logger metadata', async () => {
    const secret = 'function-error-secret-7f3a91'
    const rawError = `failed ${secret} __var_API_KEY __sim_code_3_binding_1`
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
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext) => {
        blockContext.resolvedSecretTraceRegistry?.recordResolved('API_KEY', secret)
        throw new Error(rawError)
      },
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
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_KEY',
        plaintext: secret,
        encryptedValue: 'encrypted-api-key',
      },
    ])
    const node = createNode(block)
    node.outgoingEdges.set('error-edge', { target: 'error-handler', sourceHandle: EDGE.ERROR })

    await expect(executor.execute(ctx, node, block)).resolves.toEqual({ error: rawError })

    expect(state.getBlockOutput(block.id)).toEqual({ error: rawError })
    expect(ctx.blockLogs[0]).toMatchObject({ error: rawError, output: { error: rawError } })
    const executionLogger = blockExecutorBaseLogger.withMetadata.mock.results.at(-1)?.value
    expect(executionLogger).toBeDefined()
    const loggerCalls = JSON.stringify({
      error: executionLogger?.error.mock.calls,
      info: executionLogger?.info.mock.calls,
    })
    expect(loggerCalls).toContain('{{API_KEY}}')
    expect(loggerCalls).not.toContain(secret)
    expect(loggerCalls).not.toContain('__var_')
    expect(loggerCalls).not.toContain('__sim_')
  })
})

describe('BlockExecutor streaming pump', () => {
  function createAgentBlock(): SerializedBlock {
    return {
      id: 'agent-block-1',
      metadata: { id: BlockType.AGENT, name: 'Agent' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.AGENT, params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
  }

  function createExecutor(handler: BlockHandler) {
    const block = createAgentBlock()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
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
    return { executor, block, state, resolver }
  }

  it('projects resolver-owned inputs for display without carrying them into output provenance', async () => {
    const secret = 'x'
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, _block, inputs) => {
        expect(inputs.systemPrompt).toBe(secret)
        const sourceRegistry = blockContext.resolvedSecretTraceRegistry
        blockContext.resolvedSecretTraceRegistry = sourceRegistry?.forkForInputPaths([])
        return { content: 'Box' }
      },
    }
    const { executor, block, state } = createExecutor(handler)
    block.config.params = { systemPrompt: '{{TOKEN}}' }
    const ctx = createContext(state)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'encrypted-token' },
    ])
    ctx.environmentVariables = { TOKEN: secret }
    ctx.resolvedSecretTraceRegistry = registry

    await executor.execute(ctx, createNode(block), block)

    expect(ctx.blockLogs[0]).toMatchObject({
      input: { systemPrompt: '{{TOKEN}}' },
      output: { content: 'Box' },
    })
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('keeps terminal error output provenance separate from low-entropy input provenance', async () => {
    const secret = 'x'
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, _block, inputs) => {
        expect(inputs.systemPrompt).toBe(secret)
        const sourceRegistry = blockContext.resolvedSecretTraceRegistry
        blockContext.resolvedSecretTraceRegistry = sourceRegistry?.forkForInputPaths([])
        throw new Error('Box')
      },
    }
    const { executor, block, state } = createExecutor(handler)
    block.config.params = { systemPrompt: '{{TOKEN}}' }
    const ctx = createContext(state)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'encrypted-token' },
    ])
    ctx.environmentVariables = { TOKEN: secret }
    ctx.resolvedSecretTraceRegistry = registry

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow('Agent: Box')

    expect(ctx.blockLogs[0]).toMatchObject({
      input: { systemPrompt: '{{TOKEN}}' },
      output: { error: 'Box' },
    })
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('carries echoed raw-boundary secret provenance on terminal errors only', async () => {
    const promptSecret = 'x'
    const apiKey = 'provider-credential-secret'
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext) => {
        const sourceRegistry = blockContext.resolvedSecretTraceRegistry
        blockContext.errorResolvedSecretTraceRegistry = sourceRegistry?.forkForInputPaths([
          ['apiKey'],
        ])
        blockContext.resolvedSecretTraceRegistry = sourceRegistry?.forkForInputPaths([])
        throw new Error(`Provider rejected ${apiKey}`)
      },
    }
    const { executor, block, state } = createExecutor(handler)
    block.config.params = {
      systemPrompt: '{{PROMPT_TOKEN}}',
      apiKey: '{{API_KEY}}',
    }
    const ctx = createContext(state)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PROMPT_TOKEN',
        plaintext: promptSecret,
        encryptedValue: 'encrypted-prompt-token',
      },
      { name: 'API_KEY', plaintext: apiKey, encryptedValue: 'encrypted-api-key' },
    ])
    ctx.environmentVariables = { PROMPT_TOKEN: promptSecret, API_KEY: apiKey }
    ctx.resolvedSecretTraceRegistry = registry

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(
      `Agent: Provider rejected ${apiKey}`
    )

    expect(ctx.blockLogs[0]).toMatchObject({
      input: { systemPrompt: '{{PROMPT_TOKEN}}', apiKey: '[REDACTED]' },
      output: { error: `Provider rejected ${apiKey}` },
    })
    const expectedProvenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-api-key' }],
    }
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance).toEqual(expectedProvenance)
    expect(ctx.blockLogs[0]?.displayResolvedSecretTraceProvenance).toEqual(expectedProvenance)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('suppresses an incomplete display input without failing block execution', async () => {
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext) => {
        blockContext.resolvedSecretTraceRegistry =
          blockContext.resolvedSecretTraceRegistry?.forkForInputPaths([])
        return { content: 'done' }
      },
    }
    const { executor, block, state, resolver } = createExecutor(handler)
    const inputs = {
      userPrompt: 'Use the configured tool.',
      tools: [{ params: { apiKey: 'unknown-value' } }],
    }
    vi.spyOn(resolver, 'resolveInputs').mockImplementation(async (blockContext) => {
      await blockContext.resolvedSecretTraceRegistry?.importProvenanceForValueAtInputPath(
        { version: 1 },
        'unknown-value',
        ['tools', '0', 'params', 'apiKey'],
        { trusted: true }
      )
      return inputs
    })
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry()

    await expect(executor.execute(ctx, createNode(block), block)).resolves.toEqual({
      content: 'done',
    })

    expect(ctx.blockLogs[0]?.input).toEqual({})
    expect(ctx.blockLogs[0]?.output).toEqual({ content: 'done' })
  })

  function createAgentEventsStreamingHandler(options: {
    events: Array<Record<string, unknown>>
    attachThinkingOnDrain?: string
    failAfterText?: string
    streamError?: Error
    onFullContent?: (content: string) => void | Promise<void>
    finishReason?: string
    resolvedSecret?: { name: string; value: string }
    separateResultRegistry?: boolean
  }): BlockHandler {
    return {
      canHandle: () => true,
      execute: async (blockContext) => {
        if (options.resolvedSecret) {
          blockContext.resolvedSecretTraceRegistry?.recordResolved(
            options.resolvedSecret.name,
            options.resolvedSecret.value
          )
        }
        const diagnosticRegistry = options.separateResultRegistry
          ? blockContext.resolvedSecretTraceRegistry
          : undefined
        if (diagnosticRegistry) {
          blockContext.resolvedSecretTraceRegistry = diagnosticRegistry.forkForInputPaths([])
        }
        const timeSegment: Record<string, unknown> = {
          type: 'model',
          name: 'claude-test',
          startTime: Date.now(),
          endTime: Date.now(),
          duration: 1,
        }
        const output = {
          content: '',
          model: 'claude-test',
          tokens: { input: 1, output: 2, total: 3 },
          providerTiming: {
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
            timeSegments: [timeSegment],
          },
          cost: { input: 0, output: 0, total: 0 },
        }

        const stream = new ReadableStream({
          start(controller) {
            if (options.failAfterText) {
              controller.enqueue({
                type: 'text_delta',
                text: options.failAfterText,
                turn: 'final',
              })
              controller.error(options.streamError ?? new Error('provider reset'))
              return
            }
            for (const event of options.events) {
              controller.enqueue(event)
            }
            if (options.attachThinkingOnDrain) {
              timeSegment.thinkingContent = options.attachThinkingOnDrain
            }
            if (options.finishReason) {
              timeSegment.finishReason = options.finishReason
            }
            controller.close()
          },
        })

        return {
          stream,
          streamFormat: 'agent-events-v1' as const,
          execution: {
            success: true,
            output,
            logs: [],
            metadata: {
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              duration: 1,
            },
          },
          onFullContent: options.onFullContent,
          diagnosticResolvedSecretTraceRegistry: diagnosticRegistry,
        }
      },
    }
  }

  it('projects answer text to onStream and content; sink gets full timeline', async () => {
    const onFullContent = vi.fn()
    const handler = createAgentEventsStreamingHandler({
      events: [
        { type: 'thinking_delta', text: 'hmm ' },
        { type: 'thinking_delta', text: 'yes' },
        { type: 'text_delta', text: 'Hello ', turn: 'final' },
        { type: 'text_delta', text: 'world', turn: 'final' },
      ],
      attachThinkingOnDrain: 'hmm yes',
      onFullContent,
    })
    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)
    const forwarded: string[] = []
    const sinkEvents: Array<Record<string, unknown>> = []

    ctx.onStream = async (streamingExec) => {
      expect(streamingExec.streamFormat).toBe('text')
      streamingExec.subscribe?.({
        onEvent: async (event) => {
          sinkEvents.push(event as Record<string, unknown>)
        },
      })
      const reader = streamingExec.stream.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        forwarded.push(decoder.decode(value, { stream: true }))
      }
    }

    await executor.execute(ctx, createNode(block), block)

    expect(forwarded.join('')).toBe('Hello world')
    expect(state.getBlockOutput(block.id)?.content).toBe('Hello world')
    expect(onFullContent).toHaveBeenCalledWith('Hello world')
    expect(sinkEvents).toEqual([
      { type: 'thinking_delta', text: 'hmm ' },
      { type: 'thinking_delta', text: 'yes' },
      { type: 'text_delta', text: 'Hello ', turn: 'final' },
      { type: 'text_delta', text: 'world', turn: 'final' },
    ])
    expect(state.getBlockOutput(block.id)?.providerTiming?.timeSegments?.[0]?.thinkingContent).toBe(
      'hmm yes'
    )
  })

  it('drains without onStream and still persists answer content', async () => {
    const handler = createAgentEventsStreamingHandler({
      events: [{ type: 'text_delta', text: 'offline answer', turn: 'final' }],
    })
    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)

    await executor.execute(ctx, createNode(block), block)

    expect(state.getBlockOutput(block.id)?.content).toBe('offline answer')
  })

  it('persists tool-result provenance activated in a narrowed registry during stream drain', async () => {
    const selector = 'x'
    const resultSecret = 'stream-tool-result-secret'
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, _block, inputs) => {
        const sourceRegistry = blockContext.resolvedSecretTraceRegistry!
        sourceRegistry.recordResolvedAtInputPath('PRIVATE_SELECTOR', selector, ['selector'])
        sourceRegistry.recordResolvedInputProjection(['selector'], selector, '{{PRIVATE_SELECTOR}}')
        inputs.selector = '{{PRIVATE_SELECTOR}}'

        const runtimeRegistry = sourceRegistry.forkForInputPaths([])
        blockContext.resolvedSecretTraceRegistry = runtimeRegistry
        const output = {
          content: '',
          toolCalls: { list: [] as Array<Record<string, unknown>>, count: 0 },
        }
        const stream = new ReadableStream({
          start(controller) {
            runtimeRegistry.recordResolved('TOOL_RESULT', resultSecret, { propagated: true })
            output.toolCalls = {
              list: [{ name: 'lookup', result: { value: resultSecret, public: 'Box' } }],
              count: 1,
            }
            controller.enqueue({ type: 'text_delta', text: 'done', turn: 'final' })
            controller.close()
          },
        })

        return {
          stream,
          streamFormat: 'agent-events-v1' as const,
          execution: {
            success: true,
            output,
            logs: [],
            metadata: { startTime: new Date().toISOString(), duration: 1 },
          },
        }
      },
    }
    const { executor, block, state } = createExecutor(handler)
    block.config.params = { selector }
    const ctx = createContext(state)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PRIVATE_SELECTOR',
        plaintext: selector,
        encryptedValue: 'encrypted-selector',
      },
      {
        name: 'TOOL_RESULT',
        plaintext: resultSecret,
        encryptedValue: 'encrypted-tool-result',
      },
    ])
    ctx.resolvedSecretTraceRegistry = registry

    await executor.execute(ctx, createNode(block), block)

    expect(state.getBlockOutput(block.id)).toEqual({
      content: 'done',
      toolCalls: {
        list: [{ name: 'lookup', result: { value: resultSecret, public: 'Box' } }],
        count: 1,
      },
    })
    expect(ctx.blockLogs[0]?.input).toEqual({ selector: '{{PRIVATE_SELECTOR}}' })
    expect(state.getBlockState(block.id)?.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'TOOL_RESULT', encryptedValue: 'encrypted-tool-result' }],
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: resultSecret, replacement: '{{TOOL_RESULT}}' },
    ])
  })

  it('throws on mid-stream provider error (no truncated success)', async () => {
    const secret = 'stream-pump-secret-7f3a91'
    const rawError = new Error(`provider reset ${secret} __var_API_KEY __sim_code_4_binding_1`)
    const handler = createAgentEventsStreamingHandler({
      failAfterText: 'partial',
      streamError: rawError,
      resolvedSecret: { name: 'API_KEY', value: secret },
      separateResultRegistry: true,
    })
    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-api-key' },
    ])
    ctx.onStream = async (streamingExec) => {
      expect(streamingExec).not.toHaveProperty('diagnosticResolvedSecretTraceRegistry')
      const reader = streamingExec.stream.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch {
        // consumer may see the error; block must still fail
      }
    }

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(rawError.message)
    expect(state.getBlockOutput(block.id)?.content).not.toBe('partial')

    const executionLogger = blockExecutorBaseLogger.withMetadata.mock.results.at(-1)?.value
    expect(executionLogger).toBeDefined()
    expect(executionLogger?.error).toHaveBeenCalledWith('Error reading stream for block', {
      blockId: block.id,
      error: 'provider reset {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]',
      errorName: 'Error',
      stack: expect.any(String),
    })
    const loggerPayload = JSON.stringify(executionLogger?.error.mock.calls)
    expect(loggerPayload).toContain('{{API_KEY}}')
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(rawError.message).toContain(secret)
  })

  it('projects response parsing and full-content callback diagnostics without changing output', async () => {
    const secret = 'stream-content-secret-7f3a91'
    const content = `not-json ${secret}`
    const callbackError = new Error(
      `callback failed ${secret} __var_API_KEY __sim_code_5_binding_0`
    )
    const handler = createAgentEventsStreamingHandler({
      events: [{ type: 'text_delta', text: content, turn: 'final' }],
      onFullContent: async () => {
        throw callbackError
      },
      resolvedSecret: { name: 'API_KEY', value: secret },
    })
    const { executor, block, state } = createExecutor(handler)
    block.config.params = { responseFormat: 'json' }
    const ctx = createContext(state)
    ctx.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-api-key' },
    ])

    await executor.execute(ctx, createNode(block), block)

    expect(state.getBlockOutput(block.id)?.content).toBe(content)
    const executionLogger = blockExecutorBaseLogger.withMetadata.mock.results.at(-1)?.value
    expect(executionLogger).toBeDefined()
    expect(executionLogger?.warn).toHaveBeenCalledWith(
      'Failed to parse streamed content for response format',
      expect.objectContaining({ blockId: block.id, errorName: 'SyntaxError' })
    )
    expect(executionLogger?.error).toHaveBeenCalledWith('onFullContent callback failed', {
      blockId: block.id,
      error: 'callback failed {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]',
      errorName: 'Error',
      stack: expect.any(String),
    })
    const loggerPayload = JSON.stringify({
      warn: executionLogger?.warn.mock.calls,
      error: executionLogger?.error.mock.calls,
    })
    expect(loggerPayload).toContain('{{API_KEY}}')
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(callbackError.message).toContain(secret)
  })

  it('fails token-limited structured streams before downstream completion', async () => {
    const onFullContent = vi.fn()
    const handler = createAgentEventsStreamingHandler({
      events: [{ type: 'text_delta', text: '{"answer":"unfinished', turn: 'final' }],
      finishReason: 'max_tokens',
      onFullContent,
    })
    const { executor, block, state } = createExecutor(handler)
    block.config.params = {
      responseFormat: { type: 'object', properties: { answer: { type: 'string' } } },
    }
    const ctx = createContext(state)

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(
      /maximum output-token limit/i
    )

    expect(onFullContent).not.toHaveBeenCalled()
    expect(state.getBlockOutput(block.id)).toMatchObject({
      content: '{"answer":"unfinished',
      error: expect.stringMatching(/maximum output-token limit/i),
    })
    expect(state.getBlockOutput(block.id)?.providerTiming?.timeSegments?.[0]?.finishReason).toBe(
      'max_tokens'
    )
  })

  it('soft-completes on user abort with drained answer text (no failed block)', async () => {
    const abortController = new AbortController()
    const handler = createAgentEventsStreamingHandler({
      events: [
        { type: 'text_delta', text: 'partial answer', turn: 'final' },
        { type: 'thinking_delta', text: 'more' },
      ],
    })

    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)
    ctx.abortSignal = abortController.signal
    ctx.onStream = async (streamingExec) => {
      streamingExec.subscribe?.({ onEvent: async () => {} })
      const reader = streamingExec.stream.getReader()
      try {
        // Drain the first projected answer chunk, then Stop — pump must keep it.
        const first = await reader.read()
        expect(first.done).toBe(false)
        abortController.abort('user')
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch {
        // abort may cancel the text stream
      }
    }

    await executor.execute(ctx, createNode(block), block)

    const output = state.getBlockOutput(block.id)
    expect(output?.error).toBeUndefined()
    // Soft-complete must keep text already projected before Stop — not empty content.
    expect(output?.content).toBe('partial answer')
    expect(output).not.toMatchObject({ error: expect.any(String) })
  })

  it('fails on timeout but keeps drained answer text in block output', async () => {
    const abortController = new AbortController()
    const handler = createAgentEventsStreamingHandler({
      events: [
        { type: 'text_delta', text: 'partial before timeout', turn: 'final' },
        { type: 'thinking_delta', text: 'more' },
      ],
    })

    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)
    ctx.abortSignal = abortController.signal
    ctx.onStream = async (streamingExec) => {
      streamingExec.subscribe?.({ onEvent: async () => {} })
      const reader = streamingExec.stream.getReader()
      try {
        const first = await reader.read()
        expect(first.done).toBe(false)
        abortController.abort('timeout')
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch {
        // timeout may cancel the text stream
      }
    }

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(/timed out/i)

    const output = state.getBlockOutput(block.id)
    expect(output?.error).toBeTruthy()
    expect(output?.content).toBe('partial before timeout')
  })

  it('with PII redaction: no live forward and strips thinking from traces', async () => {
    const { redactObjectStrings } = await import('@/lib/logs/execution/pii-redaction')
    vi.mocked(redactObjectStrings).mockImplementation(async (value) => {
      if (typeof value === 'string') {
        return `[masked]${value}` as never
      }
      // Object walk is exercised elsewhere; keep streaming-stage string mask as-is.
      return value as never
    })

    const handler = createAgentEventsStreamingHandler({
      events: [
        { type: 'thinking_delta', text: 'secret thought' },
        { type: 'text_delta', text: 'alice@example.com said hi', turn: 'final' },
      ],
      attachThinkingOnDrain: 'secret thought',
    })
    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)
    const onStream = vi.fn()
    ctx.onStream = onStream
    ctx.piiBlockOutputRedaction = {
      enabled: true,
      entityTypes: ['EMAIL_ADDRESS'],
      language: 'en',
    }

    await executor.execute(ctx, createNode(block), block)

    expect(onStream).not.toHaveBeenCalled()
    expect(state.getBlockOutput(block.id)?.content).toBe('[masked]alice@example.com said hi')
    expect(
      state.getBlockOutput(block.id)?.providerTiming?.timeSegments?.[0]?.thinkingContent
    ).toBeUndefined()
  })
})
