import { describe, expect, it, vi } from 'vitest'
import { createParallelExecutionState } from '@/executor/__test-utils__/executor-mocks'
import { BlockType } from '@/executor/consts'
import { ParallelBlockHandler } from '@/executor/handlers/parallel/parallel-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedParallel } from '@/serializer/types'

describe('ParallelBlockHandler', () => {
  const mockResolver = {
    resolveBlockReferences: vi.fn((expr: string) => expr),
  }

  const mockPathTracker = {
    isInActivePath: vi.fn(),
  }

  const createMockBlock = (id: string): SerializedBlock => ({
    id,
    position: { x: 0, y: 0 },
    config: { tool: '', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: BlockType.PARALLEL, name: 'Test Parallel' },
    enabled: true,
  })

  const createMockContext = (parallel?: SerializedParallel): ExecutionContext => ({
    workflowId: 'test-workflow',
    blockStates: new Map(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopIterations: new Map(),
    loopItems: new Map(),
    completedLoops: new Set(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    workflow: {
      version: '1.0',
      blocks: [],
      connections: [],
      loops: {},
      parallels: parallel ? { [parallel.id]: parallel } : {},
    },
  })

  it('should handle parallel blocks', () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')

    expect(handler.canHandle(block)).toBe(true)

    const nonParallelBlock = { ...block, metadata: { id: BlockType.AGENT } }
    expect(handler.canHandle(nonParallelBlock)).toBe(false)
  })

  it('should initialize parallel block with distribution', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1', 'api-1'],
      distribution: ['item1', 'item2', 'item3'],
    }

    const context = createMockContext(parallel)
    context.workflow!.connections = [
      {
        source: 'parallel-1',
        target: 'agent-1',
        sourceHandle: 'parallel-start-source',
      },
    ]

    // First execution - initialize parallel and set up iterations
    const result = await handler.execute(block, {}, context)

    expect(result as any).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 3,
      distributionType: 'distributed',
      started: true,
      message: 'Initialized 3 parallel executions',
    })

    // Check that items were stored
    expect(context.loopItems.get('parallel-1_items')).toEqual(['item1', 'item2', 'item3'])

    // Check that target was activated
    expect(context.activeExecutionPath.has('agent-1')).toBe(true)

    // Check parallel state
    const parallelState = context.parallelExecutions?.get('parallel-1')
    expect(parallelState).toBeDefined()
    expect(parallelState?.currentIteration).toBe(1) // Indicates activation
    expect(parallelState?.parallelCount).toBe(3)
  })

  it('should handle waiting state when iterations are incomplete', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1'],
      distribution: ['item1', 'item2'],
    }

    const context = createMockContext(parallel)
    context.parallelExecutions = new Map([
      [
        'parallel-1',
        createParallelExecutionState({
          parallelCount: 2,
          distributionItems: ['item1', 'item2'],
          completedExecutions: 0,
          activeIterations: new Set([0, 1]),
          currentIteration: 1,
        }),
      ],
    ])

    context.executedBlocks.add('parallel-1')
    context.workflow!.connections = [
      {
        source: 'parallel-1',
        target: 'agent-1',
        sourceHandle: 'parallel-start-source',
      },
    ]

    // Second execution - check waiting state
    const result = await handler.execute(block, {}, context)

    expect(result as any).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 2,
      completedExecutions: 0,
      activeIterations: 2,
      waiting: true,
      message: '0 of 2 iterations completed',
    })
  })

  it('should handle completion after all iterations', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1'],
      distribution: ['item1', 'item2'],
    }

    const context = createMockContext(parallel)
    context.parallelExecutions = new Map([
      [
        'parallel-1',
        createParallelExecutionState({
          parallelCount: 2,
          distributionItems: ['item1', 'item2'],
          completedExecutions: 0,
          executionResults: new Map([
            ['iteration_0', { 'agent-1': { result: 'result1' } }],
            ['iteration_1', { 'agent-1': { result: 'result2' } }],
          ]),
          activeIterations: new Set(),
          currentIteration: 1,
        }),
      ],
    ])

    // Mark virtual blocks as executed
    context.executedBlocks.add('parallel-1')
    context.executedBlocks.add('agent-1_parallel_parallel-1_iteration_0')
    context.executedBlocks.add('agent-1_parallel_parallel-1_iteration_1')

    context.workflow!.connections = [
      {
        source: 'parallel-1',
        target: 'evaluator-1',
        sourceHandle: 'parallel-end-source',
      },
    ]

    // Execution after all iterations complete
    const result = await handler.execute(block, {}, context)

    expect(result as any).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 2,
      completed: true,
      results: [{ 'agent-1': { result: 'result1' } }, { 'agent-1': { result: 'result2' } }],
      message: 'Completed all 2 executions',
    })

    // Check that parallel was marked as completed
    expect(context.completedLoops.has('parallel-1')).toBe(true)

    // Check that post-parallel path was activated
    expect(context.activeExecutionPath.has('evaluator-1')).toBe(true)
  })

  it('should handle object distribution', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1'],
      distribution: { key1: 'value1', key2: 'value2' },
    }

    const context = createMockContext(parallel)

    const result = await handler.execute(block, {}, context)

    expect(result as any).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 2,
      distributionType: 'distributed',
      started: true,
    })

    // Check that object entries were stored correctly
    expect(context.loopItems.get('parallel-1_items')).toEqual({ key1: 'value1', key2: 'value2' })

    // Check parallel state
    const parallelState = context.parallelExecutions?.get('parallel-1')
    expect(parallelState?.distributionItems).toEqual({ key1: 'value1', key2: 'value2' })
  })

  it('should handle expression evaluation', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1'],
      distribution: '["a", "b", "c"]',
    }

    const context = createMockContext(parallel)

    const result = await handler.execute(block, {}, context)

    expect(result as any).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 3,
      distributionType: 'distributed',
    })

    expect(context.loopItems.get('parallel-1_items')).toEqual(['a', 'b', 'c'])
  })

  it('should handle parallel without distribution', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    // Ensure block.config.params doesn't have a count
    block.config.params = {}
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1'],
    }

    const context = createMockContext(parallel)

    const result = await handler.execute(block, {}, context)

    expect(result as any).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 1,
      distributionType: 'count',
      started: true,
      message: 'Initialized 1 parallel execution',
    })

    // Should not have items when no distribution
    expect(context.loopItems.has('parallel-1_items')).toBe(false)
  })

  describe('multiple downstream connections', () => {
    it('should make results available to all downstream blocks', async () => {
      const handler = new ParallelBlockHandler()
      const parallelBlock = createMockBlock('parallel-1')
      parallelBlock.config.params = {
        parallelType: 'collection',
        count: 3,
      }

      const parallel: SerializedParallel = {
        id: 'parallel-1',
        nodes: ['agent-1'],
        distribution: ['item1', 'item2', 'item3'],
      }

      const context = createMockContext(parallel)
      context.workflow!.connections = [
        {
          source: 'parallel-1',
          target: 'agent-1',
          sourceHandle: 'parallel-start-source',
        },
        {
          source: 'parallel-1',
          target: 'function-1',
          sourceHandle: 'parallel-end-source',
        },
        {
          source: 'parallel-1',
          target: 'parallel-2',
          sourceHandle: 'parallel-end-source',
        },
      ]

      // Initialize parallel
      const initResult = await handler.execute(parallelBlock, {}, context)
      expect((initResult as any).started).toBe(true)
      expect((initResult as any).parallelCount).toBe(3)

      // Simulate all virtual blocks being executed
      const parallelState = context.parallelExecutions?.get('parallel-1')
      expect(parallelState).toBeDefined()

      // Mark all virtual blocks as executed and store results
      for (let i = 0; i < 3; i++) {
        const virtualBlockId = `agent-1_parallel_parallel-1_iteration_${i}`
        context.executedBlocks.add(virtualBlockId)

        // Store iteration results
        parallelState!.executionResults.set(`iteration_${i}`, {
          'agent-1': {
            response: {
              content: `Result from iteration ${i}`,
              model: 'test-model',
            },
          },
        })
      }

      // Re-execute to aggregate results
      const aggregatedResult = await handler.execute(parallelBlock, {}, context)

      // Verify results are aggregated
      expect((aggregatedResult as any).completed).toBe(true)
      expect((aggregatedResult as any).results).toHaveLength(3)

      // Verify block state is stored
      const blockState = context.blockStates.get('parallel-1')
      expect(blockState).toBeDefined()
      expect(blockState?.output.results).toHaveLength(3)

      // Verify both downstream blocks are activated
      expect(context.activeExecutionPath.has('function-1')).toBe(true)
      expect(context.activeExecutionPath.has('parallel-2')).toBe(true)

      // Verify parallel is marked as completed
      expect(context.completedLoops.has('parallel-1')).toBe(true)

      // Simulate downstream blocks trying to access results
      // This should work without errors
      const storedResults = context.blockStates.get('parallel-1')?.output.results
      expect(storedResults).toBeDefined()
      expect(storedResults).toHaveLength(3)
    })

    it('should handle reference resolution when multiple parallel blocks exist', async () => {
      const handler = new ParallelBlockHandler()

      // Create first parallel block
      const parallel1Block = createMockBlock('parallel-1')
      parallel1Block.config.params = {
        parallelType: 'collection',
        count: 2,
      }

      // Create second parallel block (even if not connected)
      const parallel2Block = createMockBlock('parallel-2')
      parallel2Block.config.params = {
        parallelType: 'collection',
        collection: '<parallel.results>', // This references the first parallel
      }

      // Set up context with both parallels
      const context: ExecutionContext = {
        workflowId: 'test-workflow',
        blockStates: new Map(),
        blockLogs: [],
        metadata: { duration: 0 },
        environmentVariables: {},
        decisions: { router: new Map(), condition: new Map() },
        loopIterations: new Map(),
        loopItems: new Map(),
        completedLoops: new Set(),
        executedBlocks: new Set(),
        activeExecutionPath: new Set(),
        workflow: {
          version: '1.0',
          blocks: [
            parallel1Block,
            parallel2Block,
            {
              id: 'agent-1',
              position: { x: 0, y: 0 },
              config: { tool: BlockType.AGENT, params: {} },
              inputs: {},
              outputs: {},
              metadata: { id: BlockType.AGENT, name: 'Agent 1' },
              enabled: true,
            },
            {
              id: 'function-1',
              position: { x: 0, y: 0 },
              config: {
                tool: BlockType.FUNCTION,
                params: {
                  code: 'return <parallel.results>;',
                },
              },
              inputs: {},
              outputs: {},
              metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
              enabled: true,
            },
          ],
          connections: [
            {
              source: 'parallel-1',
              target: 'agent-1',
              sourceHandle: 'parallel-start-source',
            },
            {
              source: 'parallel-1',
              target: 'function-1',
              sourceHandle: 'parallel-end-source',
            },
            {
              source: 'parallel-1',
              target: 'parallel-2',
              sourceHandle: 'parallel-end-source',
            },
          ],
          loops: {},
          parallels: {
            'parallel-1': {
              id: 'parallel-1',
              nodes: ['agent-1'],
              distribution: ['item1', 'item2'],
            },
            'parallel-2': {
              id: 'parallel-2',
              nodes: [],
              distribution: '<parallel.results>',
            },
          },
        },
      }

      // Initialize first parallel
      await handler.execute(parallel1Block, {}, context)

      // Simulate execution of agent blocks
      const parallelState = context.parallelExecutions?.get('parallel-1')
      for (let i = 0; i < 2; i++) {
        context.executedBlocks.add(`agent-1_parallel_parallel-1_iteration_${i}`)
        parallelState!.executionResults.set(`iteration_${i}`, {
          'agent-1': { content: `Result ${i}` },
        })
      }

      // Re-execute first parallel to aggregate results
      const result = await handler.execute(parallel1Block, {}, context)
      expect((result as any).completed).toBe(true)

      // Verify the block state is available
      const blockState = context.blockStates.get('parallel-1')
      expect(blockState).toBeDefined()
      expect(blockState?.output.results).toHaveLength(2)

      // Now when function block tries to resolve <parallel.results>, it should work
      // even though parallel-2 exists on the canvas
      expect(() => {
        // This simulates what the resolver would do
        const state = context.blockStates.get('parallel-1')
        if (!state) throw new Error('No state found for block parallel-1')
        const results = state.output?.results
        if (!results) throw new Error('No results found')
        return results
      }).not.toThrow()
    })
  })

  describe('PathTracker integration', () => {
    it('should activate children when in active path', async () => {
      const handler = new ParallelBlockHandler(mockResolver as any, mockPathTracker as any)
      const block = createMockBlock('parallel-1')
      const parallel = {
        id: 'parallel-1',
        nodes: ['agent-1'],
        distribution: ['item1', 'item2'],
      }

      const context = createMockContext(parallel)
      context.workflow!.connections = [
        {
          source: 'parallel-1',
          target: 'agent-1',
          sourceHandle: 'parallel-start-source',
        },
      ]

      // Mock PathTracker to return true (block is in active path)
      mockPathTracker.isInActivePath.mockReturnValue(true)

      await handler.execute(block, {}, context)

      // Should activate children when in active path
      expect(context.activeExecutionPath.has('agent-1')).toBe(true)
      expect(mockPathTracker.isInActivePath).toHaveBeenCalledWith('parallel-1', context)
    })

    it('should not activate children when not in active path', async () => {
      const handler = new ParallelBlockHandler(mockResolver as any, mockPathTracker as any)
      const block = createMockBlock('parallel-1')
      const parallel = {
        id: 'parallel-1',
        nodes: ['agent-1'],
        distribution: ['item1', 'item2'],
      }

      const context = createMockContext(parallel)
      context.workflow!.connections = [
        {
          source: 'parallel-1',
          target: 'agent-1',
          sourceHandle: 'parallel-start-source',
        },
      ]

      // Mock PathTracker to return false (block is not in active path)
      mockPathTracker.isInActivePath.mockReturnValue(false)

      await handler.execute(block, {}, context)

      // Should not activate children when not in active path
      expect(context.activeExecutionPath.has('agent-1')).toBe(false)
      expect(mockPathTracker.isInActivePath).toHaveBeenCalledWith('parallel-1', context)
    })

    it('should handle PathTracker errors gracefully', async () => {
      const handler = new ParallelBlockHandler(mockResolver as any, mockPathTracker as any)
      const block = createMockBlock('parallel-1')
      const parallel = {
        id: 'parallel-1',
        nodes: ['agent-1'],
        distribution: ['item1', 'item2'],
      }

      const context = createMockContext(parallel)
      context.workflow!.connections = [
        {
          source: 'parallel-1',
          target: 'agent-1',
          sourceHandle: 'parallel-start-source',
        },
      ]

      // Mock PathTracker to throw error
      mockPathTracker.isInActivePath.mockImplementation(() => {
        throw new Error('PathTracker error')
      })

      await handler.execute(block, {}, context)

      // Should default to activating children when PathTracker fails
      expect(context.activeExecutionPath.has('agent-1')).toBe(true)
    })
  })
})
