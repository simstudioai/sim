/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/execution/cancellation', () => ({
  isExecutionCancelled: vi.fn(),
  isRedisCancellationEnabled: vi.fn(),
}))

import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { ExecutionEngine } from './engine'

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
        await new Promise((resolve) => setTimeout(resolve, executeDelay))
      }
      return { nodeId: 'test', output: {}, isFinalOutput: false }
    }),
    handleNodeCompletion: vi.fn(),
  }
  return mock as unknown as MockNodeOrchestrator
}

describe('ExecutionEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(isExecutionCancelled as Mock).mockResolvedValue(false)
    ;(isRedisCancellationEnabled as Mock).mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Normal execution', () => {
    it('should execute a simple linear workflow', async () => {
      const startNode = createMockNode('start', 'starter')
      const endNode = createMockNode('end', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'end' })
      endNode.incomingEdges.add('start')

      const dag = createMockDAG([startNode, endNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['end']
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(nodeOrchestrator.executionCount).toBe(2)
    })

    it('should mark execution as successful when completed without cancellation', async () => {
      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(result.status).toBeUndefined()
    })

    it('should execute all nodes in a multi-node workflow', async () => {
      const nodes = [
        createMockNode('start', 'starter'),
        createMockNode('middle1', 'function'),
        createMockNode('middle2', 'function'),
        createMockNode('end', 'function'),
      ]

      nodes[0].outgoingEdges.set('e1', { target: 'middle1' })
      nodes[1].outgoingEdges.set('e2', { target: 'middle2' })
      nodes[2].outgoingEdges.set('e3', { target: 'end' })

      const dag = createMockDAG(nodes)
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['middle1']
        if (node.id === 'middle1') return ['middle2']
        if (node.id === 'middle2') return ['end']
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.success).toBe(true)
      expect(nodeOrchestrator.executionCount).toBe(4)
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

    it('should not wait for slow executions when cancelled', async () => {
      const abortController = new AbortController()

      const startNode = createMockNode('start', 'starter')
      const slowNode = createMockNode('slow', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'slow' })

      const dag = createMockDAG([startNode, slowNode])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['slow']
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator(500)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      const executionPromise = engine.run('start')
      setTimeout(() => abortController.abort(), 50)

      const startTime = Date.now()
      const result = await executionPromise
      const duration = Date.now() - startTime

      expect(result.status).toBe('cancelled')
      expect(duration).toBeLessThan(400)
    })

    it('should return cancelled status even if error thrown during cancellation', async () => {
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
      expect(result.success).toBe(false)
    })
  })

  describe('Cancellation via Redis', () => {
    it('should check Redis for cancellation when enabled', async () => {
      ;(isRedisCancellationEnabled as Mock).mockReturnValue(true)
      ;(isExecutionCancelled as Mock).mockResolvedValue(false)

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run('start')

      expect(isExecutionCancelled as Mock).toHaveBeenCalled()
    })

    it('should stop execution when Redis reports cancellation', async () => {
      ;(isRedisCancellationEnabled as Mock).mockReturnValue(true)

      let checkCount = 0
      ;(isExecutionCancelled as Mock).mockImplementation(async () => {
        checkCount++
        return checkCount > 1
      })

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
      const nodeOrchestrator = createMockNodeOrchestrator(150)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('node0')

      expect(result.success).toBe(false)
      expect(result.status).toBe('cancelled')
    })

    it('should respect cancellation check interval', async () => {
      ;(isRedisCancellationEnabled as Mock).mockReturnValue(true)
      ;(isExecutionCancelled as Mock).mockResolvedValue(false)

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run('start')

      expect((isExecutionCancelled as Mock).mock.calls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Loop execution with cancellation', () => {
    it('should break out of loop when cancelled mid-iteration', async () => {
      const abortController = new AbortController()

      const loopStartNode = createMockNode('loop-start', 'loop_sentinel')
      loopStartNode.metadata = { isSentinel: true, sentinelType: 'start', loopId: 'loop1' }

      const loopBodyNode = createMockNode('loop-body', 'function')
      loopBodyNode.metadata = { isLoopNode: true, loopId: 'loop1' }

      const loopEndNode = createMockNode('loop-end', 'loop_sentinel')
      loopEndNode.metadata = { isSentinel: true, sentinelType: 'end', loopId: 'loop1' }

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
      const nodeOrchestrator = createMockNodeOrchestrator(5)

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
      const nodeOrchestrator = createMockNodeOrchestrator(50)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      const executionPromise = engine.run('start')
      setTimeout(() => abortController.abort(), 30)

      const result = await executionPromise

      expect(result.status).toBe('cancelled')
      expect(nodeOrchestrator.executionCount).toBeLessThan(11)
    })

    it('should not wait for all parallel branches when cancelled', async () => {
      const abortController = new AbortController()

      const startNode = createMockNode('start', 'starter')
      const slowNodes = Array.from({ length: 5 }, (_, i) => createMockNode(`slow${i}`, 'function'))

      slowNodes.forEach((_, i) => {
        startNode.outgoingEdges.set(`edge${i}`, { target: `slow${i}` })
      })

      const dag = createMockDAG([startNode, ...slowNodes])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return slowNodes.map((_, i) => `slow${i}`)
        return []
      })
      const nodeOrchestrator = createMockNodeOrchestrator(200)

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      const executionPromise = engine.run('start')
      setTimeout(() => abortController.abort(), 50)

      const startTime = Date.now()
      const result = await executionPromise
      const duration = Date.now() - startTime

      expect(result.status).toBe('cancelled')
      expect(duration).toBeLessThan(500)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty DAG gracefully', async () => {
      const dag = createMockDAG([])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run()

      expect(result.success).toBe(true)
      expect(nodeOrchestrator.executionCount).toBe(0)
    })

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

    it('should populate metadata on cancellation', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.metadata).toBeDefined()
      expect(result.metadata.endTime).toBeDefined()
      expect(result.metadata.duration).toBeDefined()
    })

    it('should return logs even when cancelled', async () => {
      const abortController = new AbortController()

      const startNode = createMockNode('start', 'starter')
      const dag = createMockDAG([startNode])
      const context = createMockContext({ abortSignal: abortController.signal })
      context.blockLogs.push({
        blockId: 'test',
        blockName: 'Test',
        blockType: 'test',
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        success: true,
      })

      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      abortController.abort()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('start')

      expect(result.logs).toBeDefined()
      expect(result.logs.length).toBeGreaterThan(0)
    })
  })

  describe('Error handling in execution', () => {
    it('should fail execution when a single node throws an error', async () => {
      const startNode = createMockNode('start', 'starter')
      const errorNode = createMockNode('error-node', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'error-node' })

      const dag = createMockDAG([startNode, errorNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['error-node']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'error-node') {
            throw new Error('Block execution failed')
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('Block execution failed')
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
            await new Promise((resolve) => setTimeout(resolve, 10))
            throw new Error('Parallel branch failed')
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('Parallel branch failed')
    })

    it('should capture only the first error when multiple parallel branches fail', async () => {
      const startNode = createMockNode('start', 'starter')
      const parallelNodes = Array.from({ length: 3 }, (_, i) =>
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

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'parallel0') {
            await new Promise((resolve) => setTimeout(resolve, 10))
            throw new Error('First error')
          }
          if (nodeId === 'parallel1') {
            await new Promise((resolve) => setTimeout(resolve, 20))
            throw new Error('Second error')
          }
          if (nodeId === 'parallel2') {
            await new Promise((resolve) => setTimeout(resolve, 30))
            throw new Error('Third error')
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('First error')
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
            await new Promise((resolve) => setTimeout(resolve, 10))
            throw new Error('Fast error')
          }
          if (nodeId === 'slow') {
            await new Promise((resolve) => setTimeout(resolve, 50))
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

    it('should not queue new nodes after an error occurs', async () => {
      const startNode = createMockNode('start', 'starter')
      const errorNode = createMockNode('error-node', 'function')
      const afterErrorNode = createMockNode('after-error', 'function')

      startNode.outgoingEdges.set('edge1', { target: 'error-node' })
      errorNode.outgoingEdges.set('edge2', { target: 'after-error' })

      const dag = createMockDAG([startNode, errorNode, afterErrorNode])
      const context = createMockContext()

      const queuedNodes: string[] = []
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') {
          queuedNodes.push('error-node')
          return ['error-node']
        }
        if (node.id === 'error-node') {
          queuedNodes.push('after-error')
          return ['after-error']
        }
        return []
      })

      const executedNodes: string[] = []
      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          executedNodes.push(nodeId)
          if (nodeId === 'error-node') {
            throw new Error('Node error')
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('Node error')

      expect(executedNodes).not.toContain('after-error')
    })

    it('should populate error result with metadata when execution fails', async () => {
      const startNode = createMockNode('start', 'starter')
      const errorNode = createMockNode('error-node', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'error-node' })

      const dag = createMockDAG([startNode, errorNode])
      const context = createMockContext()
      context.blockLogs.push({
        blockId: 'start',
        blockName: 'Start',
        blockType: 'starter',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 10,
        success: true,
      })

      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['error-node']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'error-node') {
            const error = new Error('Execution failed') as any
            error.executionResult = {
              success: false,
              output: { partial: 'data' },
              logs: context.blockLogs,
              metadata: context.metadata,
            }
            throw error
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      try {
        await engine.run('start')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.executionResult).toBeDefined()
        expect(error.executionResult.metadata.endTime).toBeDefined()
        expect(error.executionResult.metadata.duration).toBeDefined()
      }
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

    it('should stop loop iteration when error occurs in loop body', async () => {
      const loopStartNode = createMockNode('loop-start', 'loop_sentinel')
      loopStartNode.metadata = { isSentinel: true, sentinelType: 'start', loopId: 'loop1' }

      const loopBodyNode = createMockNode('loop-body', 'function')
      loopBodyNode.metadata = { isLoopNode: true, loopId: 'loop1' }

      const loopEndNode = createMockNode('loop-end', 'loop_sentinel')
      loopEndNode.metadata = { isSentinel: true, sentinelType: 'end', loopId: 'loop1' }

      const afterLoopNode = createMockNode('after-loop', 'function')

      loopStartNode.outgoingEdges.set('edge1', { target: 'loop-body' })
      loopBodyNode.outgoingEdges.set('edge2', { target: 'loop-end' })
      loopEndNode.outgoingEdges.set('loop_continue', {
        target: 'loop-start',
        sourceHandle: 'loop_continue',
      })
      loopEndNode.outgoingEdges.set('loop_complete', {
        target: 'after-loop',
        sourceHandle: 'loop_complete',
      })

      const dag = createMockDAG([loopStartNode, loopBodyNode, loopEndNode, afterLoopNode])
      const context = createMockContext()

      let iterationCount = 0
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'loop-start') return ['loop-body']
        if (node.id === 'loop-body') return ['loop-end']
        if (node.id === 'loop-end') {
          iterationCount++
          if (iterationCount < 5) return ['loop-start']
          return ['after-loop']
        }
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'loop-body' && iterationCount >= 2) {
            throw new Error('Loop body error on iteration 3')
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('loop-start')).rejects.toThrow('Loop body error on iteration 3')

      expect(iterationCount).toBeLessThanOrEqual(3)
    })

    it('should handle error that is not an Error instance', async () => {
      const startNode = createMockNode('start', 'starter')
      const errorNode = createMockNode('error-node', 'function')
      startNode.outgoingEdges.set('edge1', { target: 'error-node' })

      const dag = createMockDAG([startNode, errorNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['error-node']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'error-node') {
            throw 'String error message'
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      await expect(engine.run('start')).rejects.toThrow('String error message')
    })

    it('should preserve partial output when error occurs after some blocks complete', async () => {
      const startNode = createMockNode('start', 'starter')
      const successNode = createMockNode('success', 'function')
      const errorNode = createMockNode('error-node', 'function')

      startNode.outgoingEdges.set('edge1', { target: 'success' })
      successNode.outgoingEdges.set('edge2', { target: 'error-node' })

      const dag = createMockDAG([startNode, successNode, errorNode])
      const context = createMockContext()
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'start') return ['success']
        if (node.id === 'success') return ['error-node']
        return []
      })

      const nodeOrchestrator = {
        executionCount: 0,
        executeNode: vi.fn().mockImplementation(async (_ctx: ExecutionContext, nodeId: string) => {
          if (nodeId === 'success') {
            return { nodeId, output: { successData: 'preserved' }, isFinalOutput: false }
          }
          if (nodeId === 'error-node') {
            throw new Error('Late error')
          }
          return { nodeId, output: {}, isFinalOutput: false }
        }),
        handleNodeCompletion: vi.fn(),
      } as unknown as MockNodeOrchestrator

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)

      try {
        await engine.run('start')
        expect.fail('Should have thrown')
      } catch (error: any) {
        // Verify the error was thrown
        expect(error.message).toBe('Late error')
        // The partial output should be available in executionResult if attached
        if (error.executionResult) {
          expect(error.executionResult.output).toBeDefined()
        }
      }
    })
  })

  describe('Cancellation flag behavior', () => {
    it('should set cancelledFlag when abort signal fires', async () => {
      const abortController = new AbortController()

      const nodes = Array.from({ length: 3 }, (_, i) => createMockNode(`node${i}`, 'function'))
      for (let i = 0; i < nodes.length - 1; i++) {
        nodes[i].outgoingEdges.set(`e${i}`, { target: `node${i + 1}` })
      }

      const dag = createMockDAG(nodes)
      const context = createMockContext({ abortSignal: abortController.signal })
      const edgeManager = createMockEdgeManager((node) => {
        if (node.id === 'node0') {
          abortController.abort()
          return ['node1']
        }
        return node.id === 'node1' ? ['node2'] : []
      })
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      const result = await engine.run('node0')

      expect(result.status).toBe('cancelled')
    })

    it('should cache Redis cancellation result', async () => {
      ;(isRedisCancellationEnabled as Mock).mockReturnValue(true)
      ;(isExecutionCancelled as Mock).mockResolvedValue(true)

      const nodes = Array.from({ length: 5 }, (_, i) => createMockNode(`node${i}`, 'function'))
      const dag = createMockDAG(nodes)
      const context = createMockContext()
      const edgeManager = createMockEdgeManager()
      const nodeOrchestrator = createMockNodeOrchestrator()

      const engine = new ExecutionEngine(context, dag, edgeManager, nodeOrchestrator)
      await engine.run('node0')

      expect((isExecutionCancelled as Mock).mock.calls.length).toBeLessThanOrEqual(3)
    })
  })
})
