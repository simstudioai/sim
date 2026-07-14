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

describe('BlockExecutor streaming pump (Step 3)', () => {
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
