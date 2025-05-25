import { describe, expect, it, vi } from 'vitest'
import type { SerializedBlock, SerializedParallel } from '@/serializer/types'
import { createParallelExecutionState } from '../../__test-utils__/executor-mocks'
import type { ExecutionContext } from '../../types'
import { ParallelBlockHandler } from './parallel-handler'

describe('ParallelBlockHandler', () => {
  const mockResolver = {
    resolveBlockReferences: vi.fn((expr: string) => expr),
  }

  const createMockBlock = (id: string): SerializedBlock => ({
    id,
    position: { x: 0, y: 0 },
    config: { tool: '', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: 'parallel', name: 'Test Parallel' },
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

    const nonParallelBlock = { ...block, metadata: { id: 'agent' } }
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

    expect(result).toHaveProperty('response')
    expect((result as any).response).toMatchObject({
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

    expect(result).toHaveProperty('response')
    expect((result as any).response).toMatchObject({
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
            ['iteration_0', { 'agent-1': { response: { result: 'result1' } } }],
            ['iteration_1', { 'agent-1': { response: { result: 'result2' } } }],
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

    expect(result).toHaveProperty('response')
    expect((result as any).response).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 2,
      completed: true,
      results: [
        { 'agent-1': { response: { result: 'result1' } } },
        { 'agent-1': { response: { result: 'result2' } } },
      ],
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

    expect(result).toHaveProperty('response')
    expect((result as any).response).toMatchObject({
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

    expect(result).toHaveProperty('response')
    expect((result as any).response).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 3,
      distributionType: 'distributed',
    })

    expect(context.loopItems.get('parallel-1_items')).toEqual(['a', 'b', 'c'])
  })

  it('should handle parallel without distribution', async () => {
    const handler = new ParallelBlockHandler(mockResolver as any)
    const block = createMockBlock('parallel-1')
    const parallel: SerializedParallel = {
      id: 'parallel-1',
      nodes: ['agent-1'],
    }

    const context = createMockContext(parallel)

    const result = await handler.execute(block, {}, context)

    expect(result).toHaveProperty('response')
    expect((result as any).response).toMatchObject({
      parallelId: 'parallel-1',
      parallelCount: 1,
      distributionType: 'simple',
      started: true,
      message: 'Initialized 1 parallel executions',
    })

    // Should not have items when no distribution
    expect(context.loopItems.has('parallel-1_items')).toBe(false)
  })
})
