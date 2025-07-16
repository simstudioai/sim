import { describe, expect, test, vi } from 'vitest'
import { createParallelExecutionState } from '@/executor/__test-utils__/executor-mocks'
import { BlockType } from '@/executor/consts'
import { ParallelManager } from '@/executor/parallels/parallels'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('ParallelManager', () => {
  const createMockContext = (): ExecutionContext => ({
    workflowId: 'test-workflow',
    blockStates: new Map(),
    blockLogs: [],
    metadata: { startTime: new Date().toISOString(), duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopIterations: new Map(),
    loopItems: new Map(),
    completedLoops: new Set(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    workflow: { blocks: [], connections: [], loops: {}, parallels: {}, version: '2.0' },
    parallelExecutions: new Map(),
  })

  describe('initializeParallel', () => {
    test('should initialize parallel state for array distribution', () => {
      const manager = new ParallelManager()
      const items = ['apple', 'banana', 'cherry']

      const state = manager.initializeParallel('parallel-1', items)

      expect(state.parallelCount).toBe(3)
      expect(state.distributionItems).toEqual(items)
      expect(state.completedExecutions).toBe(0)
      expect(state.executionResults).toBeInstanceOf(Map)
      expect(state.activeIterations).toBeInstanceOf(Set)
      expect(state.currentIteration).toBe(1)
    })

    test('should initialize parallel state for object distribution', () => {
      const manager = new ParallelManager()
      const items = { first: 'alpha', second: 'beta', third: 'gamma' }

      const state = manager.initializeParallel('parallel-1', items)

      expect(state.parallelCount).toBe(3)
      expect(state.distributionItems).toEqual(items)
    })
  })

  describe('getIterationItem', () => {
    test('should get item from array distribution', () => {
      const manager = new ParallelManager()
      const state = createParallelExecutionState({
        parallelCount: 3,
        distributionItems: ['apple', 'banana', 'cherry'],
      })

      expect(manager.getIterationItem(state, 0)).toBe('apple')
      expect(manager.getIterationItem(state, 1)).toBe('banana')
      expect(manager.getIterationItem(state, 2)).toBe('cherry')
    })

    test('should get entry from object distribution', () => {
      const manager = new ParallelManager()
      const state = createParallelExecutionState({
        parallelCount: 3,
        distributionItems: { first: 'alpha', second: 'beta', third: 'gamma' },
      })

      expect(manager.getIterationItem(state, 0)).toEqual(['first', 'alpha'])
      expect(manager.getIterationItem(state, 1)).toEqual(['second', 'beta'])
      expect(manager.getIterationItem(state, 2)).toEqual(['third', 'gamma'])
    })

    test('should return null for null distribution items', () => {
      const manager = new ParallelManager()
      const state = createParallelExecutionState({
        parallelCount: 0,
        distributionItems: null,
      })

      expect(manager.getIterationItem(state, 0)).toBeNull()
    })
  })

  describe('areAllVirtualBlocksExecuted', () => {
    test('should return true when all virtual blocks are executed', () => {
      const manager = new ParallelManager()
      const executedBlocks = new Set([
        'func-1_parallel_parallel-1_iteration_0',
        'func-1_parallel_parallel-1_iteration_1',
        'func-1_parallel_parallel-1_iteration_2',
      ])
      const parallel = {
        id: 'parallel-1',
        nodes: ['func-1'],
        distribution: ['a', 'b', 'c'],
      }
      const state = createParallelExecutionState({
        parallelCount: 3,
        distributionItems: ['a', 'b', 'c'],
      })

      const result = manager.areAllVirtualBlocksExecuted(
        'parallel-1',
        parallel,
        executedBlocks,
        state
      )

      expect(result).toBe(true)
    })

    test('should return false when some virtual blocks are not executed', () => {
      const manager = new ParallelManager()
      const executedBlocks = new Set([
        'func-1_parallel_parallel-1_iteration_0',
        'func-1_parallel_parallel-1_iteration_1',
        // Missing iteration_2
      ])
      const parallel = {
        id: 'parallel-1',
        nodes: ['func-1'],
        distribution: ['a', 'b', 'c'],
      }
      const state = createParallelExecutionState({
        parallelCount: 3,
        distributionItems: ['a', 'b', 'c'],
      })

      const result = manager.areAllVirtualBlocksExecuted(
        'parallel-1',
        parallel,
        executedBlocks,
        state
      )

      expect(result).toBe(false)
    })
  })

  describe('createVirtualBlockInstances', () => {
    test('should create virtual block instances for unexecuted blocks', () => {
      const manager = new ParallelManager()
      const block = {
        id: 'func-1',
        position: { x: 0, y: 0 },
        config: { tool: BlockType.FUNCTION, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }
      const executedBlocks = new Set(['func-1_parallel_parallel-1_iteration_0'])
      const activeExecutionPath = new Set(['func-1'])
      const state = createParallelExecutionState({
        parallelCount: 3,
        distributionItems: ['a', 'b', 'c'],
      })

      const virtualIds = manager.createVirtualBlockInstances(
        block,
        'parallel-1',
        state,
        executedBlocks,
        activeExecutionPath
      )

      expect(virtualIds).toEqual([
        'func-1_parallel_parallel-1_iteration_1',
        'func-1_parallel_parallel-1_iteration_2',
      ])
    })

    test('should skip blocks not in active execution path', () => {
      const manager = new ParallelManager()
      const block = {
        id: 'func-1',
        position: { x: 0, y: 0 },
        config: { tool: BlockType.FUNCTION, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }
      const executedBlocks = new Set<string>()
      const activeExecutionPath = new Set<string>() // Block not in active path
      const state = createParallelExecutionState({
        parallelCount: 3,
        distributionItems: ['a', 'b', 'c'],
      })

      const virtualIds = manager.createVirtualBlockInstances(
        block,
        'parallel-1',
        state,
        executedBlocks,
        activeExecutionPath
      )

      expect(virtualIds).toEqual([])
    })
  })

  describe('setupIterationContext', () => {
    test('should set up context for array distribution', () => {
      const manager = new ParallelManager()
      const context = createMockContext()

      const state = {
        parallelCount: 3,
        distributionItems: ['apple', 'banana', 'cherry'],
        completedExecutions: 0,
        executionResults: new Map(),
        activeIterations: new Set<number>(),
        currentIteration: 1,
      }

      context.parallelExecutions?.set('parallel-1', state)

      manager.setupIterationContext(context, {
        parallelId: 'parallel-1',
        iterationIndex: 1,
      })

      expect(context.loopItems.get('parallel-1_iteration_1')).toBe('banana')
      expect(context.loopItems.get('parallel-1')).toBe('banana')
      expect(context.loopIterations.get('parallel-1')).toBe(1)
    })

    test('should set up context for object distribution', () => {
      const manager = new ParallelManager()
      const context = createMockContext()

      const state = createParallelExecutionState({
        parallelCount: 2,
        distributionItems: { key1: 'value1', key2: 'value2' },
      })

      context.parallelExecutions?.set('parallel-1', state)

      manager.setupIterationContext(context, {
        parallelId: 'parallel-1',
        iterationIndex: 0,
      })

      expect(context.loopItems.get('parallel-1_iteration_0')).toEqual(['key1', 'value1'])
      expect(context.loopItems.get('parallel-1')).toEqual(['key1', 'value1'])
      expect(context.loopIterations.get('parallel-1')).toBe(0)
    })
  })

  describe('storeIterationResult', () => {
    test('should store iteration result in parallel state', () => {
      const manager = new ParallelManager()
      const context = createMockContext()

      const state = {
        parallelCount: 3,
        distributionItems: ['a', 'b', 'c'],
        completedExecutions: 0,
        executionResults: new Map(),
        activeIterations: new Set<number>(),
        currentIteration: 1,
      }

      context.parallelExecutions?.set('parallel-1', state)

      const output = { result: 'test result' }

      manager.storeIterationResult(context, 'parallel-1', 1, output)

      expect(state.executionResults.get('iteration_1')).toEqual(output)
    })
  })

  describe('processParallelIterations', () => {
    test('should re-execute parallel block when all virtual blocks are complete', async () => {
      const parallels: SerializedWorkflow['parallels'] = {
        'parallel-1': {
          id: 'parallel-1',
          nodes: ['func-1'],
          distribution: ['a', 'b', 'c'],
        },
      }

      const manager = new ParallelManager(parallels)
      const context = createMockContext()

      // Set up context as if parallel has been executed and all virtual blocks completed
      context.executedBlocks.add('parallel-1')
      context.executedBlocks.add('func-1_parallel_parallel-1_iteration_0')
      context.executedBlocks.add('func-1_parallel_parallel-1_iteration_1')
      context.executedBlocks.add('func-1_parallel_parallel-1_iteration_2')

      const state = {
        parallelCount: 3,
        distributionItems: ['a', 'b', 'c'],
        completedExecutions: 0,
        executionResults: new Map(),
        activeIterations: new Set<number>(),
        currentIteration: 1,
      }

      context.parallelExecutions?.set('parallel-1', state)

      await manager.processParallelIterations(context)

      // Should remove parallel from executed blocks and add to active path
      expect(context.executedBlocks.has('parallel-1')).toBe(false)
      expect(context.activeExecutionPath.has('parallel-1')).toBe(true)

      // Should remove child nodes from active path
      expect(context.activeExecutionPath.has('func-1')).toBe(false)
    })

    test('should skip completed parallels', async () => {
      const parallels: SerializedWorkflow['parallels'] = {
        'parallel-1': {
          id: 'parallel-1',
          nodes: ['func-1'],
          distribution: ['a', 'b', 'c'],
        },
      }

      const manager = new ParallelManager(parallels)
      const context = createMockContext()

      // Mark parallel as completed
      context.completedLoops.add('parallel-1')

      await manager.processParallelIterations(context)

      // Should not modify execution state
      expect(context.executedBlocks.size).toBe(0)
      expect(context.activeExecutionPath.size).toBe(0)
    })

    test('should handle empty parallels object', async () => {
      const manager = new ParallelManager({})
      const context = createMockContext()

      // Should complete without error
      await expect(manager.processParallelIterations(context)).resolves.toBeUndefined()
    })
  })
})
