import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { BlockType } from '@/executor/consts'
import { LoopManager } from '@/executor/loops/loops'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedLoop, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('LoopManager', () => {
  let manager: LoopManager
  let mockContext: ExecutionContext

  const createBasicLoop = (overrides?: Partial<SerializedLoop>): SerializedLoop => ({
    id: 'loop-1',
    nodes: ['block-1', 'block-2'],
    iterations: 3,
    loopType: 'for',
    ...overrides,
  })

  const createForEachLoop = (items: any, overrides?: Partial<SerializedLoop>): SerializedLoop => ({
    id: 'loop-1',
    nodes: ['block-1', 'block-2'],
    iterations: 5,
    loopType: 'forEach',
    forEachItems: items,
    ...overrides,
  })

  const createWorkflowWithLoop = (loop: SerializedLoop): SerializedWorkflow => ({
    version: '2.0',
    blocks: [
      {
        id: 'starter',
        position: { x: 0, y: 0 },
        metadata: { id: BlockType.STARTER, name: 'Start' },
        config: { tool: BlockType.STARTER, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      },
      {
        id: 'loop-1',
        position: { x: 100, y: 0 },
        metadata: { id: BlockType.LOOP, name: 'Test Loop' },
        config: { tool: BlockType.LOOP, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      },
      {
        id: 'block-1',
        position: { x: 200, y: 0 },
        metadata: { id: BlockType.FUNCTION, name: 'Block 1' },
        config: { tool: BlockType.FUNCTION, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      },
      {
        id: 'block-2',
        position: { x: 300, y: 0 },
        metadata: { id: BlockType.FUNCTION, name: 'Block 2' },
        config: { tool: BlockType.FUNCTION, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      },
      {
        id: 'after-loop',
        position: { x: 400, y: 0 },
        metadata: { id: BlockType.FUNCTION, name: 'After Loop' },
        config: { tool: BlockType.FUNCTION, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      },
    ],
    connections: [
      { source: 'starter', target: 'loop-1' },
      { source: 'loop-1', target: 'block-1', sourceHandle: 'loop-start-source' },
      { source: 'block-1', target: 'block-2' },
      { source: 'block-2', target: 'loop-1' },
      { source: 'loop-1', target: 'after-loop', sourceHandle: 'loop-end-source' },
    ],
    loops: {
      'loop-1': loop,
    },
    parallels: {},
  })

  beforeEach(() => {
    const loops = {
      'loop-1': createBasicLoop(),
    }
    manager = new LoopManager(loops)

    mockContext = createMockContext({
      workflow: createWorkflowWithLoop(createBasicLoop()),
      loopIterations: new Map([['loop-1', 0]]),
      loopItems: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(['starter', 'loop-1']),
      completedLoops: new Set(),
    })
  })

  describe('constructor', () => {
    test('should initialize with provided loops', () => {
      const loops = {
        'loop-1': createBasicLoop(),
        'loop-2': createBasicLoop({ id: 'loop-2', iterations: 5 }),
      }
      const loopManager = new LoopManager(loops)

      expect(loopManager.getIterations('loop-1')).toBe(3)
      expect(loopManager.getIterations('loop-2')).toBe(5)
    })

    test('should use default iterations for unknown loops', () => {
      const loopManager = new LoopManager({})
      expect(loopManager.getIterations('unknown-loop')).toBe(5) // default
    })

    test('should accept custom default iterations', () => {
      const loopManager = new LoopManager({}, 10)
      expect(loopManager.getIterations('unknown-loop')).toBe(10)
    })
  })

  describe('processLoopIterations', () => {
    test('should return false when no loops exist', async () => {
      const emptyManager = new LoopManager({})
      const result = await emptyManager.processLoopIterations(mockContext)
      expect(result).toBe(false)
    })

    test('should skip loops that are already completed', async () => {
      mockContext.completedLoops.add('loop-1')
      const result = await manager.processLoopIterations(mockContext)
      expect(result).toBe(false)
    })

    test('should skip loops where loop block has not been executed', async () => {
      // Loop block not in executed blocks
      const result = await manager.processLoopIterations(mockContext)
      expect(result).toBe(false)
    })

    test('should skip loops where not all blocks have been executed', async () => {
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      // block-2 not executed yet

      const result = await manager.processLoopIterations(mockContext)
      expect(result).toBe(false)
    })

    test('should reset blocks and continue iteration when not at max iterations', async () => {
      // Set up as if we've completed one iteration
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 1) // First iteration completed

      // Add some block states to verify they get reset
      mockContext.blockStates.set('block-1', {
        output: { result: 'test' },
        executed: true,
        executionTime: 100,
      })
      mockContext.blockStates.set('block-2', {
        output: { result: 'test2' },
        executed: true,
        executionTime: 200,
      })

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(false) // Not at max iterations yet

      // Verify blocks were reset
      expect(mockContext.executedBlocks.has('block-1')).toBe(false)
      expect(mockContext.executedBlocks.has('block-2')).toBe(false)
      expect(mockContext.executedBlocks.has('loop-1')).toBe(false) // Loop block also reset

      // Verify block states were cleared
      expect(mockContext.blockStates.has('block-1')).toBe(false)
      expect(mockContext.blockStates.has('block-2')).toBe(false)
      expect(mockContext.blockStates.has('loop-1')).toBe(false)

      // Verify blocks were removed from active execution path
      expect(mockContext.activeExecutionPath.has('block-1')).toBe(false)
      expect(mockContext.activeExecutionPath.has('block-2')).toBe(false)
    })

    test('should complete loop and activate end connections when max iterations reached', async () => {
      // Set up as if we've completed all iterations
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 3) // Max iterations reached

      // Set up loop execution state with some results
      mockContext.loopExecutions = new Map()
      mockContext.loopExecutions.set('loop-1', {
        maxIterations: 3,
        loopType: 'for',
        forEachItems: null,
        executionResults: new Map([
          ['iteration_0', { iteration: { 'block-1': { result: 'result1' } } }],
          ['iteration_1', { iteration: { 'block-1': { result: 'result2' } } }],
          ['iteration_2', { iteration: { 'block-1': { result: 'result3' } } }],
        ]),
        currentIteration: 3,
      })

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(true) // Loop reached max iterations

      // Verify loop was marked as completed
      expect(mockContext.completedLoops.has('loop-1')).toBe(true)

      // Verify loop block state was updated with aggregated results
      const loopBlockState = mockContext.blockStates.get('loop-1')
      expect(loopBlockState).toBeDefined()
      expect(loopBlockState?.output.completed).toBe(true)
      expect(loopBlockState?.output.results).toHaveLength(3)

      // Verify end connection was activated
      expect(mockContext.activeExecutionPath.has('after-loop')).toBe(true)
    })

    test('should handle forEach loops with array items', async () => {
      const forEachLoop = createForEachLoop(['item1', 'item2', 'item3'])
      manager = new LoopManager({ 'loop-1': forEachLoop })
      mockContext.workflow!.loops['loop-1'] = forEachLoop

      // Set up as if we've completed all iterations
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 3) // All items processed

      // Store items in context as the loop handler would
      mockContext.loopItems.set('loop-1_items', ['item1', 'item2', 'item3'])

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(true) // Loop completed
      expect(mockContext.completedLoops.has('loop-1')).toBe(true)

      const loopBlockState = mockContext.blockStates.get('loop-1')
      expect(loopBlockState?.output.loopType).toBe('forEach')
      expect(loopBlockState?.output.maxIterations).toBe(3)
    })

    test('should handle forEach loops with object items', async () => {
      const items = { key1: 'value1', key2: 'value2' }
      const forEachLoop = createForEachLoop(items)
      manager = new LoopManager({ 'loop-1': forEachLoop })
      mockContext.workflow!.loops['loop-1'] = forEachLoop

      // Set up as if we've completed all iterations
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 2) // All items processed

      // Store items in context as the loop handler would
      mockContext.loopItems.set('loop-1_items', items)

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(true) // Loop completed
      expect(mockContext.completedLoops.has('loop-1')).toBe(true)

      const loopBlockState = mockContext.blockStates.get('loop-1')
      expect(loopBlockState?.output.maxIterations).toBe(2)
    })

    test('should handle forEach loops with string items', async () => {
      const forEachLoop = createForEachLoop('["a", "b", "c"]') // JSON string
      manager = new LoopManager({ 'loop-1': forEachLoop })
      mockContext.workflow!.loops['loop-1'] = forEachLoop

      // Set up as if we've completed all iterations
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 3) // All items processed

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(true) // Loop completed
      expect(mockContext.completedLoops.has('loop-1')).toBe(true)
    })
  })

  describe('storeIterationResult', () => {
    test('should create new loop state if none exists', () => {
      const output = { result: 'test result' }

      manager.storeIterationResult(mockContext, 'loop-1', 0, 'block-1', output)

      expect(mockContext.loopExecutions).toBeDefined()
      const loopState = mockContext.loopExecutions!.get('loop-1')
      expect(loopState).toBeDefined()
      expect(loopState?.maxIterations).toBe(3)
      expect(loopState?.loopType).toBe('for')
      expect(loopState?.executionResults.get('iteration_0')).toEqual(output)
    })

    test('should add to existing loop state', () => {
      // Initialize loop state
      mockContext.loopExecutions = new Map()
      mockContext.loopExecutions.set('loop-1', {
        maxIterations: 3,
        loopType: 'for',
        forEachItems: null,
        executionResults: new Map(),
        currentIteration: 0,
      })

      const output1 = { result: 'result1' }
      const output2 = { result: 'result2' }

      manager.storeIterationResult(mockContext, 'loop-1', 0, 'block-1', output1)
      manager.storeIterationResult(mockContext, 'loop-1', 0, 'block-2', output2)

      const loopState = mockContext.loopExecutions.get('loop-1')
      const iterationResults = loopState?.executionResults.get('iteration_0')

      expect(iterationResults).toEqual(output2)
    })

    test('should handle forEach loop state creation', () => {
      const forEachLoop = createForEachLoop(['item1', 'item2'])
      manager = new LoopManager({ 'loop-1': forEachLoop })

      const output = { result: 'test result' }

      manager.storeIterationResult(mockContext, 'loop-1', 0, 'block-1', output)

      const loopState = mockContext.loopExecutions!.get('loop-1')
      expect(loopState?.loopType).toBe('forEach')
      expect(loopState?.forEachItems).toEqual(['item1', 'item2'])
    })
  })

  describe('getLoopIndex', () => {
    test('should return current iteration for existing loop', () => {
      mockContext.loopIterations.set('loop-1', 2)

      const index = manager.getLoopIndex('loop-1', 'block-1', mockContext)

      expect(index).toBe(2)
    })

    test('should return 0 for non-existent loop iteration', () => {
      const index = manager.getLoopIndex('non-existent', 'block-1', mockContext)

      expect(index).toBe(0)
    })

    test('should return 0 for unknown loop', () => {
      const unknownManager = new LoopManager({})
      const index = unknownManager.getLoopIndex('unknown', 'block-1', mockContext)

      expect(index).toBe(0)
    })
  })

  describe('getIterations', () => {
    test('should return iterations for existing loop', () => {
      expect(manager.getIterations('loop-1')).toBe(3)
    })

    test('should return default iterations for non-existent loop', () => {
      expect(manager.getIterations('non-existent')).toBe(5) // default
    })
  })

  describe('getCurrentItem', () => {
    test('should return current item for loop', () => {
      mockContext.loopItems.set('loop-1', ['current-item'])

      const item = manager.getCurrentItem('loop-1', mockContext)

      expect(item).toEqual(['current-item'])
    })

    test('should return undefined for non-existent loop item', () => {
      const item = manager.getCurrentItem('non-existent', mockContext)

      expect(item).toBeUndefined()
    })
  })

  describe('allBlocksExecuted (private method testing through processLoopIterations)', () => {
    test('should handle router blocks with selected paths', async () => {
      // Create a workflow with a router block inside the loop
      const workflow = createWorkflowWithLoop(createBasicLoop())
      workflow.blocks[2].metadata!.id = BlockType.ROUTER // Make block-1 a router
      workflow.connections = [
        { source: 'starter', target: 'loop-1' },
        { source: 'loop-1', target: 'block-1', sourceHandle: 'loop-start-source' },
        { source: 'block-1', target: 'block-2' }, // Router selects block-2
        { source: 'block-1', target: 'alternative-block' }, // Alternative path
        { source: 'block-2', target: 'loop-1' },
        { source: 'loop-1', target: 'after-loop', sourceHandle: 'loop-end-source' },
      ]

      mockContext.workflow = workflow
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.decisions.router.set('block-1', 'block-2') // Router selected block-2
      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should process the iteration since all reachable blocks are executed
      expect(result).toBe(false) // Not at max iterations yet
    })

    test('should handle condition blocks with selected paths', async () => {
      // Create a workflow with a condition block inside the loop
      const workflow = createWorkflowWithLoop(createBasicLoop())
      workflow.blocks[2].metadata!.id = BlockType.CONDITION // Make block-1 a condition
      workflow.connections = [
        { source: 'starter', target: 'loop-1' },
        { source: 'loop-1', target: 'block-1', sourceHandle: 'loop-start-source' },
        { source: 'block-1', target: 'block-2', sourceHandle: 'condition-true' },
        { source: 'block-1', target: 'alternative-block', sourceHandle: 'condition-false' },
        { source: 'block-2', target: 'loop-1' },
        { source: 'loop-1', target: 'after-loop', sourceHandle: 'loop-end-source' },
      ]

      mockContext.workflow = workflow
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.decisions.condition.set('block-1', 'true') // Condition selected true path
      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should process the iteration since all reachable blocks are executed
      expect(result).toBe(false) // Not at max iterations yet
    })

    test('should handle error connections properly', async () => {
      // Create a workflow with error handling inside the loop
      const workflow = createWorkflowWithLoop(createBasicLoop())
      workflow.connections = [
        { source: 'starter', target: 'loop-1' },
        { source: 'loop-1', target: 'block-1', sourceHandle: 'loop-start-source' },
        { source: 'block-1', target: 'block-2', sourceHandle: 'source' },
        { source: 'block-1', target: 'error-handler', sourceHandle: 'error' },
        { source: 'block-2', target: 'loop-1' },
        { source: 'loop-1', target: 'after-loop', sourceHandle: 'loop-end-source' },
      ]

      mockContext.workflow = workflow
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')

      // Set block-1 to have no error (successful execution)
      mockContext.blockStates.set('block-1', {
        output: { result: 'success' },
        executed: true,
        executionTime: 100,
      })

      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should process the iteration since the success path was followed
      expect(result).toBe(false) // Not at max iterations yet
    })

    test('should handle blocks with errors following error paths', async () => {
      // Create a workflow with error handling inside the loop
      const workflow = createWorkflowWithLoop(createBasicLoop())
      workflow.blocks.push({
        id: 'error-handler',
        position: { x: 350, y: 100 },
        metadata: { id: BlockType.FUNCTION, name: 'Error Handler' },
        config: { tool: BlockType.FUNCTION, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      })
      workflow.loops['loop-1'].nodes.push('error-handler')
      workflow.connections = [
        { source: 'starter', target: 'loop-1' },
        { source: 'loop-1', target: 'block-1', sourceHandle: 'loop-start-source' },
        { source: 'block-1', target: 'block-2', sourceHandle: 'source' },
        { source: 'block-1', target: 'error-handler', sourceHandle: 'error' },
        { source: 'error-handler', target: 'loop-1' },
        { source: 'block-2', target: 'loop-1' },
        { source: 'loop-1', target: 'after-loop', sourceHandle: 'loop-end-source' },
      ]

      mockContext.workflow = workflow
      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('error-handler')

      // Set block-1 to have an error
      mockContext.blockStates.set('block-1', {
        output: {
          error: 'Something went wrong',
        },
        executed: true,
        executionTime: 100,
      })

      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should process the iteration since the error path was followed
      expect(result).toBe(false) // Not at max iterations yet
    })
  })

  describe('edge cases and error handling', () => {
    test('should handle empty loop nodes array', async () => {
      const emptyLoop = createBasicLoop({ nodes: [] })
      manager = new LoopManager({ 'loop-1': emptyLoop })
      mockContext.workflow!.loops['loop-1'] = emptyLoop

      mockContext.executedBlocks.add('loop-1')
      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should complete immediately since there are no blocks to execute
      expect(result).toBe(false)
    })

    test('should handle missing workflow in context', async () => {
      mockContext.workflow = undefined

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(false)
    })

    test('should handle missing loop configuration', async () => {
      // Remove loop from workflow
      if (mockContext.workflow) {
        mockContext.workflow.loops = {}
      }

      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should skip processing since loop config is missing
      expect(result).toBe(false)
    })

    test('should handle forEach loop with invalid JSON string', async () => {
      const forEachLoop = createForEachLoop('invalid json')
      manager = new LoopManager({ 'loop-1': forEachLoop })
      mockContext.workflow!.loops['loop-1'] = forEachLoop

      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should handle gracefully and use default iterations
      expect(result).toBe(false)
    })

    test('should handle forEach loop with null items', async () => {
      const forEachLoop = createForEachLoop(null)
      manager = new LoopManager({ 'loop-1': forEachLoop })
      mockContext.workflow!.loops['loop-1'] = forEachLoop

      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')
      mockContext.loopIterations.set('loop-1', 1)

      const result = await manager.processLoopIterations(mockContext)

      // Should handle gracefully
      expect(result).toBe(false)
    })
  })

  describe('integration scenarios', () => {
    test('should handle multiple loops in workflow', async () => {
      const loops = {
        'loop-1': createBasicLoop({ iterations: 2 }),
        'loop-2': createBasicLoop({ id: 'loop-2', nodes: ['block-3'], iterations: 3 }),
      }
      manager = new LoopManager(loops)

      // Set up context for both loops
      mockContext.loopIterations.set('loop-1', 2) // loop-1 at max
      mockContext.loopIterations.set('loop-2', 1) // loop-2 not at max

      mockContext.executedBlocks.add('loop-1')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')

      // Set up loop execution states
      mockContext.loopExecutions = new Map()
      mockContext.loopExecutions.set('loop-1', {
        maxIterations: 2,
        loopType: 'for',
        forEachItems: null,
        executionResults: new Map([
          ['iteration_0', { iteration: { 'block-1': { result: 'result1' } } }],
          ['iteration_1', { iteration: { 'block-1': { result: 'result2' } } }],
        ]),
        currentIteration: 2,
      })

      const result = await manager.processLoopIterations(mockContext)

      expect(result).toBe(true) // loop-1 reached max iterations
      expect(mockContext.completedLoops.has('loop-1')).toBe(true)
      expect(mockContext.completedLoops.has('loop-2')).toBe(false)
    })

    test('should handle nested loop scenarios (loop inside another loop)', async () => {
      // This tests the scenario where a loop block might be inside another loop
      const outerLoop = createBasicLoop({
        id: 'outer-loop',
        nodes: ['inner-loop', 'block-1'],
        iterations: 2,
      })
      const innerLoop = createBasicLoop({
        id: 'inner-loop',
        nodes: ['block-2'],
        iterations: 3,
      })

      const loops = {
        'outer-loop': outerLoop,
        'inner-loop': innerLoop,
      }
      manager = new LoopManager(loops)

      // Set up context - inner loop completed, outer loop still running
      mockContext.loopIterations.set('outer-loop', 1)
      mockContext.loopIterations.set('inner-loop', 3)

      mockContext.executedBlocks.add('outer-loop')
      mockContext.executedBlocks.add('inner-loop')
      mockContext.executedBlocks.add('block-1')
      mockContext.executedBlocks.add('block-2')

      mockContext.completedLoops.add('inner-loop')

      const result = await manager.processLoopIterations(mockContext)

      // Should reset outer loop for next iteration
      expect(result).toBe(false)
      expect(mockContext.executedBlocks.has('inner-loop')).toBe(false)
      expect(mockContext.executedBlocks.has('block-1')).toBe(false)
    })
  })
})
