/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { calculateStreamingCost } from '@/lib/tokenization'
import { BlockType } from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { serializePauseSnapshot } from '@/executor/execution/snapshot-serializer'
import { ExecutionState } from '@/executor/execution/state'
import type { ContextExtensions } from '@/executor/execution/types'
import type { BlockHandler, ExecutionContext, ExecutionResult } from '@/executor/types'
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

function createExecutorForTest(
  block: SerializedBlock,
  state: ExecutionState,
  handler: BlockHandler,
  extensions: Partial<ContextExtensions> = {}
): BlockExecutor {
  const workflow: SerializedWorkflow = {
    version: '1',
    blocks: [block],
    connections: [],
    loops: {},
    parallels: {},
  }
  const resolver = new VariableResolver(workflow, {}, state)

  return new BlockExecutor(
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
      ...extensions,
    },
    state
  )
}

describe('BlockExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it.each([
    { label: 'provider time segments', includeTimeSegments: true },
    { label: 'fallback tool calls', includeTimeSegments: false },
  ])(
    'sanitizes agent trace I/O while preserving runtime values with $label',
    async ({ includeTimeSegments }) => {
      const secret = 'trace-secret/value'
      const unreferencedValue = 'us-east-1'
      const block: SerializedBlock = {
        ...createBlock(),
        id: 'agent-block-1',
        metadata: { id: BlockType.AGENT, name: 'Agent' },
        config: {
          tool: BlockType.AGENT,
          params: {
            prompt: 'Use {{TRACE_SECRET}}',
          },
        },
      }
      const state = new ExecutionState()
      const execute = vi.fn(async (_ctx, _block, inputs) => {
        expect(inputs.prompt).toBe(`Use ${secret}`)
        return {
          content: `Echoed ${secret}`,
          region: unreferencedValue,
          providerTiming: {
            startTime: '2024-01-01T10:00:00.000Z',
            endTime: '2024-01-01T10:00:02.000Z',
            duration: 2000,
            ...(includeTimeSegments && {
              timeSegments: [
                {
                  type: 'model' as const,
                  name: 'Model',
                  startTime: 1704103200000,
                  endTime: 1704103201000,
                  duration: 1000,
                  assistantContent: `Calling with ${secret}`,
                  toolCalls: [
                    {
                      id: 'call-1',
                      name: 'lookup',
                      arguments: { query: secret },
                    },
                  ],
                },
                {
                  type: 'tool' as const,
                  name: 'lookup',
                  startTime: 1704103201000,
                  endTime: 1704103202000,
                  duration: 1000,
                },
              ],
            }),
          },
          toolCalls: {
            list: [
              {
                name: 'lookup',
                arguments: { query: secret },
                result: { echoed: secret },
                duration: 1000,
              },
            ],
            count: 1,
          },
          childTraceSpans: [
            {
              id: 'child-1',
              name: 'Child',
              type: 'function',
              duration: 1,
              startTime: '2024-01-01T10:00:00.000Z',
              endTime: '2024-01-01T10:00:00.001Z',
              input: { query: secret },
              output: { echoed: secret },
            },
          ],
        }
      })
      const handler: BlockHandler = {
        canHandle: () => true,
        execute,
      }
      const onBlockComplete = vi.fn(async () => {})
      const executor = createExecutorForTest(block, state, handler, { onBlockComplete })
      const ctx = createContext(state)
      ctx.environmentVariables = {
        TRACE_SECRET: secret,
        UNREFERENCED_REGION: unreferencedValue,
      }

      const output = await executor.execute(ctx, createNode(block), block)

      expect(output.content).toBe(`Echoed ${secret}`)
      expect(output.toolCalls.list[0].arguments.query).toBe(secret)
      expect(state.getBlockOutput(block.id)?.content).toBe(`Echoed ${secret}`)

      await vi.waitFor(() => {
        expect(onBlockComplete).toHaveBeenCalled()
      })

      const serializedLog = JSON.stringify(ctx.blockLogs[0])
      const serializedCallback = JSON.stringify(onBlockComplete.mock.calls[0])
      expect(serializedLog).not.toContain(secret)
      expect(serializedLog).toContain('{{TRACE_SECRET}}')
      expect(serializedLog).toContain(unreferencedValue)
      expect(serializedCallback).not.toContain(secret)
      expect(serializedCallback).toContain('{{TRACE_SECRET}}')

      const { traceSpans } = buildTraceSpans({
        success: true,
        output: {},
        logs: ctx.blockLogs,
      } as ExecutionResult)
      const serializedSpans = JSON.stringify(traceSpans)
      expect(serializedSpans).not.toContain(secret)
      expect(serializedSpans).toContain('{{TRACE_SECRET}}')
    }
  )

  it('sanitizes failed logs and callbacks while preserving runtime errors', async () => {
    const secret = 'failure-secret'
    const block: SerializedBlock = {
      ...createBlock(),
      config: {
        tool: BlockType.FUNCTION,
        params: {
          code: 'throw new Error("{{TRACE_SECRET}}")',
        },
      },
    }
    const state = new ExecutionState()
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (_ctx, _block, inputs) => {
        expect(inputs.code).toContain(secret)
        throw new Error(`Execution failed with ${secret}`)
      },
    }
    const onBlockComplete = vi.fn(async () => {})
    const executor = createExecutorForTest(block, state, handler, { onBlockComplete })
    const ctx = createContext(state)
    ctx.environmentVariables = { TRACE_SECRET: secret }

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow(secret)

    expect(state.getBlockOutput(block.id)?.error).toContain(secret)
    expect(ctx.blockLogs[0].error).toBe('Execution failed with {{TRACE_SECRET}}')
    expect(JSON.stringify(ctx.blockLogs[0])).not.toContain(secret)
    await vi.waitFor(() => {
      expect(onBlockComplete).toHaveBeenCalled()
    })
    expect(JSON.stringify(onBlockComplete.mock.calls[0])).not.toContain(secret)
  })

  it('sanitizes error-handler logs without changing the handled runtime output', async () => {
    const secret = 'handled-secret'
    const block: SerializedBlock = {
      ...createBlock(),
      config: {
        tool: BlockType.FUNCTION,
        params: {
          code: 'throw new Error("{{TRACE_SECRET}}")',
        },
      },
    }
    const state = new ExecutionState()
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => {
        throw new Error(`Handled ${secret}`)
      },
    }
    const executor = createExecutorForTest(block, state, handler)
    const infoSpy = vi.spyOn(
      (
        executor as unknown as {
          execLogger: { info: (message: string, metadata?: Record<string, unknown>) => void }
        }
      ).execLogger,
      'info'
    )
    const ctx = createContext(state)
    ctx.environmentVariables = { TRACE_SECRET: secret }
    const node = createNode(block)
    node.outgoingEdges.set('error-edge', {
      id: 'error-edge',
      source: block.id,
      target: 'error-handler',
      sourceHandle: 'error',
      targetHandle: 'target',
    })

    const output = await executor.execute(ctx, node, block)

    expect(output.error).toBe(`Handled ${secret}`)
    expect(state.getBlockOutput(block.id)?.error).toBe(`Handled ${secret}`)
    expect(ctx.blockLogs[0].errorHandled).toBe(true)
    expect(JSON.stringify(ctx.blockLogs[0])).not.toContain(secret)
    expect(JSON.stringify(ctx.blockLogs[0])).toContain('{{TRACE_SECRET}}')
    expect(infoSpy).toHaveBeenCalledWith(
      'Block has error port - returning error output instead of throwing',
      expect.objectContaining({ error: 'Handled {{TRACE_SECRET}}' })
    )
  })

  it('sanitizes soft-abort agent inputs while leaving execution resolution unchanged', async () => {
    const secret = 'abort-secret'
    const block: SerializedBlock = {
      ...createBlock(),
      id: 'agent-block-1',
      metadata: { id: BlockType.AGENT, name: 'Agent' },
      config: {
        tool: BlockType.AGENT,
        params: {
          prompt: 'Use {{TRACE_SECRET}}',
        },
      },
    }
    const state = new ExecutionState()
    const abortController = new AbortController()
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (_ctx, _block, inputs) => {
        expect(inputs.prompt).toBe(`Use ${secret}`)
        abortController.abort('user')
        throw new DOMException(`Stopped ${secret}`, 'AbortError')
      },
    }
    const onBlockComplete = vi.fn(async () => {})
    const executor = createExecutorForTest(block, state, handler, { onBlockComplete })
    const ctx = createContext(state)
    ctx.environmentVariables = { TRACE_SECRET: secret }
    ctx.abortSignal = abortController.signal

    const output = await executor.execute(ctx, createNode(block), block)

    expect(output).toEqual({ content: '' })
    expect(ctx.blockLogs[0].success).toBe(true)
    expect(JSON.stringify(ctx.blockLogs[0])).not.toContain(secret)
    expect(JSON.stringify(ctx.blockLogs[0])).toContain('{{TRACE_SECRET}}')
    await vi.waitFor(() => {
      expect(onBlockComplete).toHaveBeenCalled()
    })
    expect(JSON.stringify(onBlockComplete.mock.calls[0])).not.toContain(secret)
  })

  it('keeps snapshot state executable and re-resolves current values on retry', async () => {
    const firstSecret = 'first-runtime-secret'
    const secondSecret = 'second-runtime-secret'
    const block: SerializedBlock = {
      ...createBlock(),
      config: {
        tool: BlockType.FUNCTION,
        params: {
          code: 'return "{{TRACE_SECRET}}"',
        },
      },
    }
    const state = new ExecutionState()
    const receivedRuntimeCode: string[] = []
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (_ctx, _block, inputs) => {
        receivedRuntimeCode.push(inputs.code)
        return { result: inputs.code }
      },
    }
    const executor = createExecutorForTest(block, state, handler)
    const firstContext = createContext(state)
    firstContext.environmentVariables = { TRACE_SECRET: firstSecret }

    await executor.execute(firstContext, createNode(block), block)
    const snapshot = JSON.parse(serializePauseSnapshot(firstContext, ['next-block']).snapshot) as {
      state: {
        blockStates: Record<string, { output: { result: string } }>
        blockLogs: ExecutionContext['blockLogs']
      }
    }

    expect(snapshot.state.blockStates[block.id].output.result).toContain(firstSecret)
    expect(JSON.stringify(snapshot.state.blockLogs)).not.toContain(firstSecret)
    expect(JSON.stringify(snapshot.state.blockLogs)).toContain('{{TRACE_SECRET}}')

    const resumedContext = createContext(state)
    resumedContext.blockLogs.push(...snapshot.state.blockLogs)
    resumedContext.environmentVariables = { TRACE_SECRET: secondSecret }

    await executor.execute(resumedContext, createNode(block), block)

    expect(receivedRuntimeCode).toEqual([`return "${firstSecret}"`, `return "${secondSecret}"`])
    expect(state.getBlockOutput(block.id)?.result).toContain(secondSecret)
    expect(JSON.stringify(resumedContext.blockLogs)).not.toContain(firstSecret)
    expect(JSON.stringify(resumedContext.blockLogs)).not.toContain(secondSecret)
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
})

describe('BlockExecutor streaming pump', () => {
  function createAgentBlock(params: Record<string, unknown> = {}): SerializedBlock {
    return {
      id: 'agent-block-1',
      metadata: { id: BlockType.AGENT, name: 'Agent' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.AGENT, params },
      inputs: {},
      outputs: {},
      enabled: true,
    }
  }

  function createExecutor(handler: BlockHandler, params: Record<string, unknown> = {}) {
    const block = createAgentBlock(params)
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
    return { executor, block, state }
  }

  function createAgentEventsStreamingHandler(options: {
    events: Array<Record<string, unknown>>
    attachThinkingOnDrain?: string
    failAfterText?: string
    onFullContent?: (content: string) => void | Promise<void>
  }): BlockHandler {
    return {
      canHandle: () => true,
      execute: async () => {
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
              controller.error(new Error('provider reset'))
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

  it('estimates missing streaming usage from resolved input before sanitizing logs', async () => {
    const secret = `sk-${'resolved-secret-'.repeat(20)}`
    const params = { prompt: '{{OPENAI_API_KEY}}', model: 'gpt-4o' }
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async (_ctx, _block, resolvedInputs) => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('streamed answer'))
            controller.close()
          },
        }),
        execution: {
          success: true,
          output: { content: '', model: 'gpt-4o' },
          logs: [],
          metadata: {
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 1,
          },
        },
      }),
    }
    const { executor, block, state } = createExecutor(handler, params)
    const ctx = createContext(state)
    ctx.environmentVariables = { OPENAI_API_KEY: secret }

    await executor.execute(ctx, createNode(block), block)

    const expected = calculateStreamingCost(
      'gpt-4o',
      JSON.stringify({ prompt: secret, model: 'gpt-4o' }),
      'streamed answer'
    )
    expect(state.getBlockOutput(block.id)?.tokens).toEqual(expected.tokens)
    expect(state.getBlockOutput(block.id)?.cost).toEqual(expected.cost)
    expect(ctx.blockLogs[0].input).toEqual({
      prompt: '{{OPENAI_API_KEY}}',
      model: 'gpt-4o',
    })
    expect(ctx.blockLogs[0].output?.tokens).toEqual(expected.tokens)
    expect(JSON.stringify(ctx.blockLogs[0])).not.toContain(secret)
  })

  it('throws on mid-stream provider error (no truncated success)', async () => {
    const handler = createAgentEventsStreamingHandler({
      failAfterText: 'partial',
    })
    const { executor, block, state } = createExecutor(handler)
    const ctx = createContext(state)
    ctx.onStream = async (streamingExec) => {
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

    await expect(executor.execute(ctx, createNode(block), block)).rejects.toThrow('provider reset')
    expect(state.getBlockOutput(block.id)?.content).not.toBe('partial')
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
    const secret = 'partial-stream-secret'
    const abortController = new AbortController()
    const handler = createAgentEventsStreamingHandler({
      events: [
        { type: 'text_delta', text: `partial ${secret} before timeout`, turn: 'final' },
        { type: 'thinking_delta', text: 'more' },
      ],
    })

    const { executor, block, state } = createExecutor(handler, {
      prompt: '{{TRACE_SECRET}}',
    })
    const ctx = createContext(state)
    ctx.environmentVariables = { TRACE_SECRET: secret }
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
    expect(output?.content).toBe(`partial ${secret} before timeout`)
    expect(JSON.stringify(ctx.blockLogs[0])).not.toContain(secret)
    expect(ctx.blockLogs[0].output?.content).toBe('partial {{TRACE_SECRET}} before timeout')
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
