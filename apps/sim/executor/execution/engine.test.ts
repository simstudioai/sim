import { loggerMock } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTimeoutAbortController, getRemainingExecutionMs } from '@/lib/core/execution-limits'

const { mockCancellationSubscribers, mockIsExecutionCancelled } = vi.hoisted(() => ({
  mockCancellationSubscribers: new Set<(event: { executionId: string }) => void>(),
  mockIsExecutionCancelled: vi.fn(),
}))

vi.mock('@/lib/execution/cancellation', () => ({
  subscribeToExecutionCancellation: async (executionId: string, onCancelled: () => void) => {
    const handler = (event: { executionId: string }) => {
      if (event.executionId === executionId) onCancelled()
    }
    mockCancellationSubscribers.add(handler)
    if (await mockIsExecutionCancelled(executionId)) onCancelled()
    return () => {
      mockCancellationSubscribers.delete(handler)
    }
  },
}))

import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import { ExecutionEngine } from './engine'

const executionEngineLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'ExecutionEngine'
)
const executionEngineBaseLogger =
  loggerMock.createLogger.mock.results[executionEngineLoggerCallIndex]?.value
if (!executionEngineBaseLogger) throw new Error('ExecutionEngine logger mock was not initialized')

function createMockBlock(id: string): SerializedBlock {
  return {
    id,
    metadata: { id: 'test', name: 'Test Block' },
    position: { x: 0, y: 0 },
    config: { tool: '', params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

function createMockNode(id: string, blockType = 'test'): DAGNode {
  return {
    id,
    block: {
      ...createMockBlock(id),
      metadata: { id: blockType, name: `Block ${id}` },
    },
    outgoingEdges: new Map(),
    incomingEdges: new Set(),
    metadata: {},
  }
}

function createMockContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'test-workflow',
    workspaceId: 'test-workspace',
    executionId: 'test-execution',
    userId: 'test-user',
    principal: { kind: 'session', userId: 'test-user', sessionId: 'test-session' },
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    loopExecutions: new Map(),
    parallelExecutions: new Map(),
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    metadata: {
      executionId: 'test-execution',
      startTime: new Date().toISOString(),
      pendingBlocks: [],
    },
    envVars: {},
    ...overrides,
  }
}

function createMockDAG(nodes: DAGNode[]): DAG {
  const nodeMap = new Map<string, DAGNode>()
  nodes.forEach((node) => nodeMap.set(node.id, node))
  return {
    nodes: nodeMap,
    loopConfigs: new Map(),
    parallelConfigs: new Map(),
  }
}

interface MockEdgeManager extends EdgeManager {
  processOutgoingEdges: ReturnType<typeof vi.fn>
}

function createMockEdgeManager(
  processOutgoingEdgesImpl?: (node: DAGNode) => string[]
): MockEdgeManager {
  const mockFn = vi.fn().mockImplementation(processOutgoingEdgesImpl || (() => []))
  return {
    processOutgoingEdges: mockFn,
    isNodeReady: vi.fn().mockReturnValue(true),
    deactivateEdgeAndDescendants: vi.fn(),
    restoreIncomingEdge: vi.fn(),
    clearDeactivatedEdges: vi.fn(),
    clearDeactivatedEdgesForNodes: vi.fn(),
    getDeactivatedEdges: vi.fn(() => []),
    getNodesWithActivatedEdge: vi.fn(() => []),
    markNodeWithActivatedEdge: vi.fn(),
    deactivateResumedEdge: vi.fn(),
    hasActivatedEdge: vi.fn(() => false),
  } as unknown as MockEdgeManager
}

interface MockNodeOrchestrator extends NodeExecutionOrchestrator {
  executionCount: number
}

function createMockNodeOrchestrator(executeDelay = 0): MockNodeOrchestrator {
  const mock = {
    executionCount: 0,
    executeNode: vi.fn().mockImplementation(async () => {
      mock.executionCount++
      if (executeDelay > 0) {
        await sleep(executeDelay)
      }
      return { nodeId: 'test', output: {}, isFinalOutput: false }
    }),
    handleNodeCompletion: vi.fn(),
  }
  return mock as unknown as MockNodeOrchestrator
}

describe('ExecutionEngine', () => {
  beforeEach(() => {
    mockCancellationSubscribers.clear()
    mockIsExecutionCancelled.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Normal execution', () => {
    it('persists the selected final block provenance instead of run-global matches', async () => {
      const node = createMockNode('function', 'function')
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'Test', encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', 'Test')
      const context = createMockContext({
        decisions: { router: new Map(), condition: new Map() },
        resolvedSecretTraceRegistry: registry,
      })
      const nodeOrchestrator = createMockNodeOrchestrator()
      vi.mocked(nodeOrchestrator.executeNode).mockResolvedValue({
        nodeId: node.id,
        output: { result: 'Test' },
        isFinalOutput: true,
      })
      vi.mocked(nodeOrchestrator.handleNodeCompletion).mockImplementation(
        (_ctx, nodeId, output) => {
          context.blockStates.set(nodeId, {
            output,
            executed: true,
            executionTime: 1,
            resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
          })
        }
      )

      const engine = new ExecutionEngine(
        context,
        createMockDAG([node]),
        createMockEdgeManager(),
        nodeOrchestrator
      )
      const result = await engine.run(node.id)

      expect(result.output).toEqual({ result: 'Test' })
      expect(result.executionState?.resolvedSecretTraceProvenance?.entries).toEqual([
        { name: 'TOKEN', encryptedValue: 'ciphertext' },
      ])
      expect(result.executionState?.finalOutputResolvedSecretTraceProvenance?.entries).toEqual([])
    })

    /**
     * The crossing at the copilot boundary reads the absence of an attached result as "no block
     * ran", so the attach has to be total. A block failure is normalized on the way in, so only
     * a non-Error raised by `run`'s own work — here the cancellation subscribe it awaits before
     * the queue — reaches the catch untouched and exercises the guarantee.
     */
    it('attaches the execution result to a non-Error thrown by its own work', async () => {
      const node = createMockNode('function-1', 'function')
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'secret-value-1234', encryptedValue: 'ciphertext' },
      ])
      registry.recordResolved('TOKEN', 'secret-value-1234')
      const context = createMockContext({
        decisions: { router: new Map(), condition: new Map() },
        resolvedSecretTraceRegistry: registry,
      })
      mockIsExecutionCancelled.mockRejectedValueOnce('cancellation lookup exploded')

      const engine = new ExecutionEngine(
        context,
        createMockDAG([node]),
        createMockEdgeManager(),
        createMockNodeOrchestrator()
      )

      const thrown = await engine.run(node.id).catch((error: unknown) => error)

      expect(thrown).toBeInstanceOf(Error)
      const attached = (thrown as Error & { executionResult?: ExecutionResult }).executionResult
      expect(attached).toBeDefined()
      expect(attached?.executionState?.resolvedSecretTraceProvenance).toBeDefined()
    })

    /** Deriving must not weaken the guarantee: a latched registry still exports incomplete. */
    it('keeps the final output envelope incomplete when the registry latched', async () => {
      const node = createMockNode('loop-1', 'loop')
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'secret-value-1234', encryptedValue: 'ciphertext' },
      ])
      registry.markIncomplete('unspecified')
      const context = createMockContext({
        decisions: { router: new Map(), condition: new Map() },
        resolvedSecretTraceRegistry: registry,
      })
      const nodeOrchestrator = createMockNodeOrchestrator()
      vi.mocked(nodeOrchestrator.executeNode).mockResolvedValue({
        nodeId: node.id,
        output: { results: ['secret-value-1234'] },
        isFinalOutput: true,
      })
      vi.mocked(nodeOrchestrator.handleNodeCompletion).mockImplementation(
        (_ctx, nodeId, output) => {
          context.blockStates.set(nodeId, { output, executed: true, executionTime: 1 })
        }
      )

      const engine = new ExecutionEngine(
        context,
        createMockDAG([node]),
        createMockEdgeManager(),
        nodeOrchestrator
      )
      const result = await engine.run(node.id)

      expect(result.executionState?.finalOutputResolvedSecretTraceProvenance?.complete).toBe(false)
    })

    it('should not fall back to starter blocks for terminal resume snapshots', async () => {
      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext({
        metadata: {
          executionId: 'test-execution',
          startTime: new Date().toISOString(),
          pendingBlocks: [],
          resumeFromSnapshot: true,
        },
      })
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('hitl')

      expect(result.success).toBe(true)
      expect(nodeOrchestrator.executionCount).toBe(0)
    })

    it('deactivates a resumed pause block error edge instead of firing it', async () => {
      // Pause block has two outgoing edges: a `source` continuation edge and an
      // `error` edge to an error-notifier. On a successful resume the error edge
      // must be deactivated (never marked/queued); only the continuation fires.
      const pauseNode = createMockNode('pause-block', 'human_in_the_loop')
      pauseNode.outgoingEdges.set('pause-block→next-source', {
        target: 'next',
        sourceHandle: EDGE.SOURCE,
      })
      pauseNode.outgoingEdges.set('pause-block→notify-error', {
        target: 'error-notify',
        sourceHandle: EDGE.ERROR,
      })

      const nextNode = createMockNode('next', 'function')
      nextNode.incomingEdges.add('pause-block')

      const errorNotifyNode = createMockNode('error-notify', 'gmail')
      errorNotifyNode.incomingEdges.add('pause-block')

      const dag = createMockDAG([pauseNode, nextNode, errorNotifyNode])
      const context = createMockContext({
        metadata: {
          executionId: 'test-execution',
          startTime: new Date().toISOString(),
          pendingBlocks: [],
          // remainingEdges omit sourceHandle (as persisted snapshots do), forcing
          // the engine to resolve the handle from the live DAG.
          remainingEdges: [
            { source: 'pause-block', target: 'next' },
            { source: 'pause-block', target: 'error-notify' },
          ],
        } as any,
      })
      const edgeManager = createMockEdgeManager(() => [])
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run()

      // Continuation edge fires; error edge is deactivated, not activated/queued.
      expect(edgeManager.markNodeWithActivatedEdge).toHaveBeenCalledWith('next')
      expect(edgeManager.markNodeWithActivatedEdge).not.toHaveBeenCalledWith('error-notify')
      expect(edgeManager.deactivateResumedEdge).toHaveBeenCalledWith(
        'pause-block',
        'error-notify',
        EDGE.ERROR
      )
      // A pure error-handler target (never activated) must not be executed.
      expect(nodeOrchestrator.executeNode).not.toHaveBeenCalledWith(context, 'error-notify')
    })

    it('re-queues a convergence target when a resumed pause error edge is pruned', async () => {
      // The join is fed by a succeeding block's `source` edge (activated in
      // phase 1) AND the pause block's `error` edge. On resume the error edge is
      // pruned, but the join must still run because it already had a genuine
      // activation — otherwise it would be silently stranded.
      const pauseNode = createMockNode('pause-block', 'human_in_the_loop')
      pauseNode.outgoingEdges.set('pause-block→join-error', {
        target: 'join',
        sourceHandle: EDGE.ERROR,
      })
      const joinNode = createMockNode('join', 'function')
      joinNode.incomingEdges.add('pause-block')

      const dag = createMockDAG([pauseNode, joinNode])
      const context = createMockContext({
        metadata: {
          executionId: 'test-execution',
          startTime: new Date().toISOString(),
          pendingBlocks: [],
          remainingEdges: [{ source: 'pause-block', target: 'join' }],
        } as any,
      })
      const edgeManager = createMockEdgeManager(() => [])
      // Join already received a genuine activation in phase 1 and is now ready.
      vi.mocked(edgeManager.hasActivatedEdge).mockReturnValue(true)
      vi.mocked(edgeManager.isNodeReady).mockReturnValue(true)
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run()

      expect(edgeManager.deactivateResumedEdge).toHaveBeenCalledWith(
        'pause-block',
        'join',
        EDGE.ERROR
      )
      // Pruning is via deactivation, never force-activation...
      expect(edgeManager.markNodeWithActivatedEdge).not.toHaveBeenCalledWith('join')
      // ...but the already-activated convergence node still runs.
      expect(nodeOrchestrator.executeNode).toHaveBeenCalledWith(context, 'join')
    })

    it('prefers the continuation handle when a pause block also errors into the same target', async () => {
      // Pause block wires BOTH source and error into the same target. The error
      // edge is registered first, but on a successful resume the continuation
      // (source) handle must win, so the target is activated, not pruned.
      const pauseNode = createMockNode('pause-block', 'human_in_the_loop')
      pauseNode.outgoingEdges.set('pause-block→both-error', {
        target: 'both',
        sourceHandle: EDGE.ERROR,
      })
      pauseNode.outgoingEdges.set('pause-block→both-source', {
        target: 'both',
        sourceHandle: EDGE.SOURCE,
      })
      const bothNode = createMockNode('both', 'function')
      bothNode.incomingEdges.add('pause-block')

      const dag = createMockDAG([pauseNode, bothNode])
      const context = createMockContext({
        metadata: {
          executionId: 'test-execution',
          startTime: new Date().toISOString(),
          pendingBlocks: [],
          remainingEdges: [{ source: 'pause-block', target: 'both' }],
        } as any,
      })
      const edgeManager = createMockEdgeManager(() => [])
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run()

      expect(edgeManager.markNodeWithActivatedEdge).toHaveBeenCalledWith('both')
      expect(edgeManager.deactivateResumedEdge).not.toHaveBeenCalled()
      expect(nodeOrchestrator.executeNode).toHaveBeenCalledWith(context, 'both')
    })

    it('records paused block completion before returning paused result', async () => {
      const node = createMockNode('hitl', 'function')
      const dag = createMockDAG([node])
      const context = createMockContext({
        decisions: { router: new Map(), condition: new Map() },
      })
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()
      const pauseOutput = {
        response: { status: 'paused' },
        _pauseMetadata: {
          contextId: 'pause-1',
          blockId: 'hitl',
          response: { status: 'paused' },
          timestamp: new Date().toISOString(),
          pauseKind: 'hitl',
        },
      }
      vi.mocked(nodeOrchestrator.executeNode).mockResolvedValue({
        nodeId: 'hitl',
        output: pauseOutput,
        isFinalOutput: false,
      })

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('hitl')

      expect(result.status).toBe('paused')
      expect(nodeOrchestrator.handleNodeCompletion).toHaveBeenCalledWith(
        context,
        'hitl',
        pauseOutput
      )
    })
    it('stops a sequential run after the selected formatter without scheduling its publishing successor', async () => {
      const nodes = [
        createMockNode('start', 'starter'),
        createMockNode('formatter', 'function'),
        createMockNode('publish', 'slack'),
      ]
      nodes[0].outgoingEdges.set('a', { target: 'formatter' })
      nodes[1].outgoingEdges.set('b', { target: 'publish' })
      const context = createMockContext({ stopAfterBlockId: 'formatter' })
      const orchestrator = createMockNodeOrchestrator()
      vi.mocked(orchestrator.executeNode).mockImplementation(async (_ctx, nodeId) => ({
        nodeId,
        output: { result: nodeId },
        isFinalOutput: false,
      }))
      const edges = createMockEdgeManager((node) =>
        node.id === 'start' ? ['formatter'] : node.id === 'formatter' ? ['publish'] : []
      )
      const result = await new ExecutionEngine(
        context,
        createMockDAG(nodes),
        edges,
        orchestrator
      ).run('start')
      expect(result.success).toBe(true)
      expect(vi.mocked(orchestrator.executeNode).mock.calls.map((call) => call[1])).toEqual([
        'start',
        'formatter',
      ])
      expect(orchestrator.handleNodeCompletion).toHaveBeenCalledWith(context, 'formatter', {
        result: 'formatter',
      })
    })

    it('finishes the chosen branch if a condition bypasses the stop target', async () => {
      const nodes = [
        createMockNode('start', 'starter'),
        createMockNode('target', 'function'),
        createMockNode('alternate', 'slack'),
      ]
      nodes[0].outgoingEdges.set('a', { target: 'target' })
      nodes[0].outgoingEdges.set('b', { target: 'alternate' })
      const context = createMockContext({ stopAfterBlockId: 'target' })
      const orchestrator = createMockNodeOrchestrator()
      vi.mocked(orchestrator.executeNode).mockImplementation(async (_ctx, nodeId) => ({
        nodeId,
        output: {},
        isFinalOutput: false,
      }))
      const result = await new ExecutionEngine(
        context,
        createMockDAG(nodes),
        createMockEdgeManager((node) => (node.id === 'start' ? ['alternate'] : [])),
        orchestrator
      ).run('start')
      expect(result.success).toBe(true)
      expect(vi.mocked(orchestrator.executeNode).mock.calls.map((call) => call[1])).toEqual([
        'start',
        'alternate',
      ])
    })

    it('waits for already running sibling actions when stop-after is reached', async () => {
      const nodes = [
        createMockNode('start', 'starter'),
        createMockNode('formatter', 'function'),
        createMockNode('sibling', 'slack'),
      ]
      nodes[0].outgoingEdges.set('a', { target: 'formatter' })
      nodes[0].outgoingEdges.set('b', { target: 'sibling' })
      const context = createMockContext({ stopAfterBlockId: 'formatter' })
      const orchestrator = createMockNodeOrchestrator()
      const formatterFinished = Promise.withResolvers<void>()
      const completed: string[] = []
      vi.mocked(orchestrator.executeNode).mockImplementation(async (_ctx, nodeId) => {
        if (nodeId === 'sibling') await formatterFinished.promise
        return { nodeId, output: {}, isFinalOutput: false }
      })
      vi.mocked(orchestrator.handleNodeCompletion).mockImplementation((_ctx, nodeId) => {
        completed.push(nodeId)
        if (nodeId === 'formatter') formatterFinished.resolve()
      })
      const result = await new ExecutionEngine(
        context,
        createMockDAG(nodes),
        createMockEdgeManager((node) => (node.id === 'start' ? ['formatter', 'sibling'] : [])),
        orchestrator
      ).run('start')
      expect(result.success).toBe(true)
      expect(completed).toEqual(['start', 'formatter', 'sibling'])
    })
  })

  describe('Cancellation via AbortSignal', () => {
    it('should stop execution immediately when aborted before start', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.status).toBe('cancelled')
      expect(nodeOrchestrator.executionCount).toBe(0)
      expect(context.abortSignal?.aborted).toBe(true)
    })

    it('should stop execution when aborted mid-workflow', async () => {
      const abortController = new AbortController()

      const nodes = Array.from({ length: 5 }, (_, i) => createMockNode(`node${i}`, 'function'))
      for (let i = 0; i < nodes.length - 1; i++) {
        nodes[i].outgoingEdges.set(`e${i}`, { target: `node${i + 1}` })
      }

      const dag = createMockDAG(nodes)
      const context = createMockContext({ abortSignal: abortController.signal })

      let callCount = 0
      const edgeManager = createMockEdgeManager((node) => {
        callCount++
        if (callCount === 2) abortController.abort()
        const idx = Number.parseInt(node.id.replace('node', ''))
        if (idx < 4) return [`node${idx + 1}`]
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('node0')

      expect(result.success).toBe(false)
      expect(result.status).toBe('cancelled')
      expect(nodeOrchestrator.executionCount).toBeLessThan(5)
    })
  })

  describe('Cancellation via Redis', () => {
    it('aborts the active execution signal without dropping its deadline', async () => {
      mockIsExecutionCancelled.mockResolvedValue(true)
      const timeoutController = createTimeoutAbortController(60_000)
      const startNode = createMockNode('start', 'starter')
      const context = createMockContext({
        executionId: 'pubsub-signal-execution',
        abortSignal: timeoutController.signal,
      })
      const engine = new ExecutionEngine(
        context,
        createMockDAG([startNode]),
        createMockEdgeManager(),
        createMockNodeOrchestrator()
      )

      try {
        expect(context.abortSignal).not.toBe(timeoutController.signal)
        expect(getRemainingExecutionMs(context.abortSignal)).toBeGreaterThan(0)

        await expect(engine.run('start')).resolves.toMatchObject({ status: 'cancelled' })
        expect(context.abortSignal?.aborted).toBe(true)
      } finally {
        timeoutController.cleanup()
      }
    })

    it('should stop execution when Redis reports cancellation', async () => {
      mockIsExecutionCancelled.mockResolvedValue(true)

      const nodes = Array.from({ length: 5 }, (_, i) => createMockNode(`node${i}`, 'function'))
      for (let i = 0; i < nodes.length - 1; i++) {
        nodes[i].outgoingEdges.set(`e${i}`, { target: `node${i + 1}` })
      }

      const dag = createMockDAG(nodes)
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        const idx = Number.parseInt(node.id.replace('node', ''))
        if (idx < 4) return [`node${idx + 1}`]
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator(1)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('node0')

      expect(result.success).toBe(false)
      expect(result.status).toBe('cancelled')
    })

    it('wakes from a slow in-flight node when a pub/sub cancellation arrives', async () => {
      mockIsExecutionCancelled.mockResolvedValue(false)

      const startNode = createMockNode('start', 'starter')
      const slowNode = createMockNode('slow', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'slow' })

      const dag = createMockDAG([startNode, slowNode])
      const context = createMockContext({ executionId: 'pubsub-execution' })
      const edgeManager = createMockEdgeManager((node) => (node.id === 'start' ? ['slow'] : []))
      const nodeOrchestrator = createMockNodeOrchestrator(500)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const executionPromise = engine.run('start')

      setTimeout(() => {
        for (const handler of mockCancellationSubscribers) {
          handler({ executionId: 'pubsub-execution' })
        }
      }, 5)

      const startTime = Date.now()
      const result = await executionPromise
      const duration = Date.now() - startTime

      expect(result.status).toBe('cancelled')
      expect(duration).toBeLessThan(100)
    })

    it('ignores pub/sub events targeting other executions', async () => {
      mockIsExecutionCancelled.mockResolvedValue(false)

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext({ executionId: 'execution-a' })
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      for (const handler of mockCancellationSubscribers) {
        handler({ executionId: 'execution-b' })
      }

      const result = await engine.run('start')
      expect(result.status).toBeUndefined()
      expect(result.success).toBe(true)
    })

    it('honours the durable backstop when cancelled before subscribing', async () => {
      mockIsExecutionCancelled.mockResolvedValue(true)

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.status).toBe('cancelled')
      expect(nodeOrchestrator.executionCount).toBe(0)
      expect(context.abortSignal?.aborted).toBe(true)
    })

    it('leaves no cancellation timer behind once the run settles', async () => {
      mockIsExecutionCancelled.mockResolvedValue(false)
      vi.useFakeTimers()

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext({ executionId: 'poll-cleanup-execution' })
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run('start')

      const callsAtCompletion = mockIsExecutionCancelled.mock.calls.length
      // Well past several poll intervals: a surviving timer would add calls here.
      await vi.advanceTimersByTimeAsync(5_000)

      expect(vi.getTimerCount()).toBe(0)
      expect(mockIsExecutionCancelled.mock.calls.length).toBe(callsAtCompletion)
    })
  })

  describe('Loop execution with cancellation', () => {
    it('should break out of loop when cancelled mid-iteration', async () => {
      const abortController = new AbortController()

      const loopStartNode = createMockNode('loop-start', 'loop_sentinel')
      loopStartNode.metadata = {
        isSentinel: true,
        sentinelType: 'start',
        subflowId: 'loop1',
        subflowType: 'loop',
      }

      const loopBodyNode = createMockNode('loop-body', 'function')
      loopBodyNode.metadata = { isLoopNode: true, subflowId: 'loop1', subflowType: 'loop' }

      const loopEndNode = createMockNode('loop-end', 'loop_sentinel')
      loopEndNode.metadata = {
        isSentinel: true,
        sentinelType: 'end',
        subflowId: 'loop1',
        subflowType: 'loop',
      }

      loopStartNode.outgoingEdges.set('edge1', { target: 'loop-body' })
      loopBodyNode.outgoingEdges.set('edge2', { target: 'loop-end' })
      loopEndNode.outgoingEdges.set('loop_continue', {
        target: 'loop-start',
        sourceHandle: 'loop_continue',
      })

      const dag = createMockDAG([loopStartNode, loopBodyNode, loopEndNode])
      const context = createMockContext({ abortSignal: abortController.signal })

      let iterationCount = 0
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'loop-start') return ['loop-body']
        if (node.id === 'loop-body') return ['loop-end']
        if (node.id === 'loop-end') {
          iterationCount++
          if (iterationCount === 3) abortController.abort()
          return ['loop-start']
        }
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator(1)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('loop-start')

      expect(result.status).toBe('cancelled')
      expect(iterationCount).toBeLessThan(100)
    })
  })

  describe('Parallel execution with cancellation', () => {
    it('should stop queueing parallel branches when cancelled', async () => {
      const abortController = new AbortController()

      const startNode = createMockNode('start', 'starter')
      const parallelNodes = Array.from({ length: 10 }, (_, i) =>
        createMockNode(`parallel${i}`, 'function')
      )

      parallelNodes.forEach((_, i) => {
        startNode.outgoingEdges.set(`edge${i}`, { target: `parallel${i}` })
      })

      const dag = createMockDAG([startNode, ...parallelNodes])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') {
          return parallelNodes.map((_, i) => `parallel${i}`)
        }
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator(1)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      const executionPromise = engine.run('start')
      setTimeout(() => abortController.abort(), 1)

      const result = await executionPromise

      expect(result.status).toBe('cancelled')
      expect(nodeOrchestrator.executionCount).toBeLessThan(11)
    })
  })

  describe('Edge cases', () => {
    it('should preserve partial output when cancelled', async () => {
      const abortController = new AbortController()

      const startNode = createMockNode('start', 'starter')
      const endNode = createMockNode('end', 'function')
      endNode.outgoingEdges = new Map()

      startNode.outgoingEdges.set('edge1', { target: 'end' })

      const dag = createMockDAG([startNode, endNode])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['end']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'start') {
            return { nodeId: 'start', output: { startData: 'value' }, isFinalOutput: false }
          }
          abortController.abort()
          return { nodeId: 'end', output: { endData: 'value' }, isFinalOutput: true }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.status).toBe('cancelled')
      expect(result.output).toBeDefined()
    })
  })

  describe('Error handling in execution', () => {
    it('should fail execution when a single node throws an error', async () => {
      const secret = 'engine-error-secret-7f3a91'
      const rawError = `Block execution failed ${secret} __var_API_KEY __sim_code_2_binding_0`
      const startNode = createMockNode('start', 'starter')
      const errorNode = createMockNode('error-node', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'error-node' })

      const dag = createMockDAG([startNode, errorNode])
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-api-key' },
      ])
      registry.recordResolved('API_KEY', secret)
      const context = createMockContext({
        resolvedSecretTraceRegistry: registry,
      })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['error-node']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'error-node') {
            throw new Error(rawError)
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow(rawError)

      const executionLogger = executionEngineBaseLogger.withMetadata.mock.results.at(-1)?.value
      expect(executionLogger).toBeDefined()
      const loggerCalls = JSON.stringify(executionLogger?.error.mock.calls)
      expect(loggerCalls).toContain('{{API_KEY}}')
      expect(loggerCalls).not.toContain(secret)
      expect(loggerCalls).not.toContain('__var_')
      expect(loggerCalls).not.toContain('__sim_')
    })

    it('should stop parallel branches when one branch throws an error', async () => {
      const startNode = createMockNode('start', 'starter')
      const parallelNodes = Array.from({ length: 5 }, (_, i) =>
        createMockNode(`parallel${i}`, 'function')
      )

      parallelNodes.forEach((_, i) => {
        startNode.outgoingEdges.set(`edge${i}`, { target: `parallel${i}` })
      })

      const dag = createMockDAG([startNode, ...parallelNodes])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return parallelNodes.map((_, i) => `parallel${i}`)
        return []
      })

      const executedNodes: string[] = []
      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          executedNodes.push(nodeId)
          if (nodeId === 'parallel0') {
            await sleep(1)
            throw new Error('Parallel branch failed')
          }
          await sleep(2)
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('Parallel branch failed')
    })

    it('should wait for ongoing executions to complete before throwing error', async () => {
      const startNode = createMockNode('start', 'starter')
      const fastErrorNode = createMockNode('fast-error', 'function')
      const slowNode = createMockNode('slow', 'function')

      startNode.outgoingEdges.set('edge1', { target: 'fast-error' })
      startNode.outgoingEdges.set('edge2', { target: 'slow' })

      const dag = createMockDAG([startNode, fastErrorNode, slowNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['fast-error', 'slow']
        return []
      })

      let slowNodeCompleted = false
      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'fast-error') {
            await sleep(1)
            throw new Error('Fast error')
          }
          if (nodeId === 'slow') {
            await sleep(1)
            slowNodeCompleted = true
            return { nodeId, output: {}, isFinalOutput: false }
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('Fast error')

      expect(slowNodeCompleted).toBe(true)
    })

    it('should prefer cancellation status over error when both occur', async () => {
      const abortController = new AbortController()

      const startNode = createMockNode('start', 'starter')
      const errorNode = createMockNode('error-node', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'error-node' })

      const dag = createMockDAG([startNode, errorNode])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['error-node']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'error-node') {
            abortController.abort()
            throw new Error('Node error')
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.status).toBe('cancelled')
      expect(result.success).toBe(false)
    })
  })

  describe('Response block exit-point behavior', () => {
    it('should lock finalOutput and stop execution when a terminal Response block fires', async () => {
      const startNode = createMockNode('start', 'starter')
      const responseNode = createMockNode('response', 'response')

      startNode.outgoingEdges.set('edge1', { target: 'response' })

      const dag = createMockDAG([startNode, responseNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['response']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          nodeOrchestrator.executionCount++
          if (nodeId === 'response') {
            return {
              nodeId,
              output: { data: { message: 'ok' }, status: 200, headers: {} },
              isFinalOutput: true,
            }
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ data: { message: 'ok' }, status: 200, headers: {} })
      expect(nodeOrchestrator.executionCount).toBe(2)
    })

    it('should stop all branches when a parallel Response block fires first', async () => {
      const startNode = createMockNode('start', 'starter')
      const responseNode = createMockNode('fast-response', 'response')
      const slowNode = createMockNode('slow-work', 'function')
      const afterSlowNode = createMockNode('after-slow', 'function')

      startNode.outgoingEdges.set('edge1', { target: 'fast-response' })
      startNode.outgoingEdges.set('edge2', { target: 'slow-work' })
      slowNode.outgoingEdges.set('edge3', { target: 'after-slow' })

      const dag = createMockDAG([startNode, responseNode, slowNode, afterSlowNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['fast-response', 'slow-work']
        if (node.id === 'slow-work') return ['after-slow']
        return []
      })

      const executedNodes: string[] = []
      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          executedNodes.push(nodeId)
          nodeOrchestrator.executionCount++
          if (nodeId === 'fast-response') {
            return {
              nodeId,
              output: { data: { fast: true }, status: 200, headers: {} },
              isFinalOutput: true,
            }
          }
          if (nodeId === 'slow-work') {
            await sleep(1)
            return { nodeId, output: { slow: true }, isFinalOutput: false }
          }
          return { nodeId, output: {}, isFinalOutput: true }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ data: { fast: true }, status: 200, headers: {} })
      expect(executedNodes).not.toContain('after-slow')
    })

    it('should not let a second Response block overwrite the first', async () => {
      const startNode = createMockNode('start', 'starter')
      const response1 = createMockNode('response1', 'response')
      const response2 = createMockNode('response2', 'response')

      startNode.outgoingEdges.set('edge1', { target: 'response1' })
      startNode.outgoingEdges.set('edge2', { target: 'response2' })

      const dag = createMockDAG([startNode, response1, response2])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['response1', 'response2']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          nodeOrchestrator.executionCount++
          if (nodeId === 'response1') {
            return {
              nodeId,
              output: { data: { first: true }, status: 200, headers: {} },
              isFinalOutput: true,
            }
          }
          if (nodeId === 'response2') {
            return {
              nodeId,
              output: { data: { second: true }, status: 201, headers: {} },
              isFinalOutput: true,
            }
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ data: { first: true }, status: 200, headers: {} })
    })

    it('should not let non-Response terminals overwrite a Response block output', async () => {
      const startNode = createMockNode('start', 'starter')
      const responseNode = createMockNode('response', 'response')
      const otherTerminal = createMockNode('other', 'function')

      startNode.outgoingEdges.set('edge1', { target: 'response' })
      startNode.outgoingEdges.set('edge2', { target: 'other' })

      const dag = createMockDAG([startNode, responseNode, otherTerminal])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['response', 'other']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          nodeOrchestrator.executionCount++
          if (nodeId === 'response') {
            return {
              nodeId,
              output: { data: { response: true }, status: 200, headers: {} },
              isFinalOutput: true,
            }
          }
          if (nodeId === 'other') {
            await sleep(1)
            return { nodeId, output: { other: true }, isFinalOutput: true }
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ data: { response: true }, status: 200, headers: {} })
    })
  })
})
