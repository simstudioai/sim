import { loggerMock } from '@sim/testing'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { createLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { validateBlockType } from '@/ee/access-control/utils/permission-check'
import { BlockType } from '@/executor/constants'
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

const { mockUploadFile, mockDownloadFile, mockMaskBatch } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockMaskBatch: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateBlockType: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
    downloadFile: mockDownloadFile,
  },
}))

vi.mock('@/lib/guardrails/mask-client', () => ({
  maskPIIBatchViaHttp: mockMaskBatch,
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
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it('isolates MCP policy provenance across concurrent blocks without a secret registry', async () => {
    const blocks = [createBlock(), { ...createBlock(), id: 'function-block-2' }]
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks,
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const contexts: ExecutionContext[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (blockContext, block) => {
        contexts.push(blockContext)
        if (contexts.length === 2) release()
        await gate
        expect(blockContext.mcpBlockId).toBe(block.id)
        return { result: 'done' }
      },
    }
    const executor = new BlockExecutor([handler], resolver, {}, state)
    const context = createContext(state)
    await Promise.all(blocks.map((block) => executor.execute(context, createNode(block), block)))
    expect(contexts[0]).not.toBe(contexts[1])
    expect(context.mcpBlockId).toBeUndefined()
  })

  it('redacts an authorized prior-execution manifest returned by a block under the current execution', async () => {
    const items = [{ email: 'alice@example.com', count: 7 }]
    const manifest = await createLargeArrayManifest(items, {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'source-execution',
    })
    clearLargeValueCacheForTests()
    mockUploadFile.mockClear()
    mockDownloadFile.mockResolvedValue(Buffer.from(JSON.stringify(items)))
    mockMaskBatch.mockImplementation(async (texts: string[]) =>
      texts.map((text) => text.replaceAll('alice@example.com', '<EMAIL_ADDRESS>'))
    )
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
      execute: async () => ({ result: manifest }),
    }
    const executor = new BlockExecutor([handler], resolver, {}, state)
    const ctx = createContext(state)
    ctx.largeValueExecutionIds = ['source-execution']
    ctx.piiBlockOutputRedaction = { enabled: true, entityTypes: ['EMAIL_ADDRESS'], language: 'en' }

    await executor.execute(ctx, createNode(block), block)

    expect(state.getBlockOutput(block.id)?.result).toMatchObject({
      preview: [{ email: '<EMAIL_ADDRESS>', count: 7 }],
      chunks: [{ ref: { executionId: 'execution-1' } }],
    })
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: manifest.chunks[0].ref.key })
    )
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        customKey: expect.stringContaining('execution/workspace-1/workflow-1/execution-1/'),
        file: Buffer.from(JSON.stringify([{ email: '<EMAIL_ADDRESS>', count: 7 }])),
      })
    )
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

  it('never surfaces the SQL or bound parameters of a database failure the block raises', async () => {
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
    const handler: BlockHandler = { canHandle: () => true, execute: vi.fn() }
    const executor = new BlockExecutor([handler], resolver, {}, state)
    const ctx = createContext(state)
    const driverError = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const databaseError = new DrizzleQueryError(
      'select "billing_blocked" from "user_stats" where "user_stats"."user_id" = $1 limit $2',
      ['owner-secret-id', 1],
      driverError
    )
    vi.mocked(validateBlockType).mockRejectedValueOnce(databaseError)
    const message = 'An internal error occurred while executing the block. Please try again.'

    const thrown = await executor.execute(ctx, createNode(block), block).catch((error) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toBe(`Function: ${message}`)
    expect(thrown.cause.cause).toBe(databaseError)
    expect(handler.execute).not.toHaveBeenCalled()
    expect(state.getBlockOutput(block.id)).toEqual({ error: message })
    expect(ctx.blockLogs[0]?.error).toBe(message)
    const surfaced = JSON.stringify([state.getBlockOutput(block.id), ctx.blockLogs])
    expect(surfaced).not.toContain('Failed query')
    expect(surfaced).not.toContain('owner-secret-id')

    const executionLogger = blockExecutorBaseLogger.withMetadata.mock.results.at(-1)?.value
    const logged = executionLogger.error.mock.calls.at(-1)?.[1]
    expect(logged).toEqual(
      expect.objectContaining({ cause: expect.objectContaining({ code: 'ECONNRESET' }) })
    )
    expect(JSON.stringify(logged)).not.toContain('owner-secret-id')
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

  function createAgentEventsStreamingHandler(options: {
    events: Array<Record<string, unknown>>
    attachThinkingOnDrain?: string
    failAfterText?: string
    streamError?: Error
    onFullContent?: (content: string) => void | Promise<void>
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
