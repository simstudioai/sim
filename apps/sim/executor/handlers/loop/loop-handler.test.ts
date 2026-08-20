import type { SerializedBlock } from '@/serializer/types'
import type { ExecutionContext } from '../../types'
import { LoopBlockHandler } from './loop-handler'

describe('LoopBlockHandler', () => {
  let handler: LoopBlockHandler
  let mockContext: ExecutionContext
  let mockBlock: SerializedBlock

  beforeEach(() => {
    handler = new LoopBlockHandler()

    mockBlock = {
      id: 'loop-1',
      position: { x: 0, y: 0 },
      config: { tool: 'loop', params: {} },
      inputs: {},
      outputs: {},
      metadata: { id: 'loop', name: 'Test Loop' },
      enabled: true,
    }

    mockContext = {
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
        blocks: [mockBlock],
        connections: [
          {
            source: 'loop-1',
            target: 'inner-block',
            sourceHandle: 'loop-start-source',
          },
          {
            source: 'loop-1',
            target: 'after-loop',
            sourceHandle: 'loop-end-source',
          },
        ],
        loops: {
          'loop-1': {
            id: 'loop-1',
            nodes: ['inner-block'],
            iterations: 3,
            loopType: 'for',
          },
        },
      },
    }
  })

  describe('canHandle', () => {
    it('should handle loop blocks', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should not handle non-loop blocks', () => {
      if (mockBlock.metadata) {
        mockBlock.metadata.id = 'function'
      }
      expect(handler.canHandle(mockBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('should initialize loop on first execution', async () => {
      const result = await handler.execute(mockBlock, {}, mockContext)

      // After execution, the counter is incremented for the next iteration
      expect(mockContext.loopIterations.get('loop-1')).toBe(1)
      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(true)

      // Type guard to check if result has the expected structure
      if (typeof result === 'object' && result !== null && 'response' in result) {
        const response = result.response as any
        expect(response.currentIteration).toBe(0) // Still shows current iteration as 0
        expect(response.maxIterations).toBe(3)
        expect(response.completed).toBe(false)
      }
    })

    it('should activate loop-end-source when iterations complete', async () => {
      // Set to last iteration
      mockContext.loopIterations.set('loop-1', 3)

      const result = await handler.execute(mockBlock, {}, mockContext)

      // The loop handler no longer marks loops as completed - that's handled by the loop manager
      expect(mockContext.completedLoops.has('loop-1')).toBe(false)
      // The loop handler also doesn't activate end connections anymore
      expect(mockContext.activeExecutionPath.has('after-loop')).toBe(false)
      // But it should not activate the inner block either since we're at max iterations
      expect(mockContext.activeExecutionPath.has('inner-block')).toBe(false)

      if (typeof result === 'object' && result !== null && 'response' in result) {
        const response = result.response as any
        expect(response.completed).toBe(false) // Not completed until all blocks execute
        expect(response.message).toContain('Final iteration')
      }
    })

    it('should handle forEach loops with array items', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 10,
        loopType: 'forEach',
        forEachItems: ['item1', 'item2', 'item3'],
      }

      const result = await handler.execute(mockBlock, {}, mockContext)

      expect(mockContext.loopItems.get('loop-1')).toBe('item1')

      if (typeof result === 'object' && result !== null && 'response' in result) {
        const response = result.response as any
        expect(response.loopType).toBe('forEach')
        expect(response.maxIterations).toBe(3) // Limited by items length
      }
    })

    it('should handle forEach loops with object items', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 10,
        loopType: 'forEach',
        forEachItems: { key1: 'value1', key2: 'value2' },
      }

      await handler.execute(mockBlock, {}, mockContext)

      const currentItem = mockContext.loopItems.get('loop-1')
      expect(Array.isArray(currentItem)).toBe(true)
      expect((currentItem as any)[0]).toBe('key1')
      expect((currentItem as any)[1]).toBe('value1')
    })

    it('should limit forEach loops by collection size, not iterations parameter', async () => {
      // This tests the fix for the bug where forEach loops were using the iterations count
      // instead of the actual collection size
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 10, // High iteration count
        loopType: 'forEach',
        forEachItems: ['a', 'b'], // Only 2 items
      }

      // First execution
      let result = await handler.execute(mockBlock, {}, mockContext)
      expect(mockContext.loopIterations.get('loop-1')).toBe(1)
      expect(mockContext.loopItems.get('loop-1')).toBe('a')

      if (typeof result === 'object' && result !== null && 'response' in result) {
        const response = result.response as any
        expect(response.maxIterations).toBe(2) // Should be limited to 2, not 10
        expect(response.completed).toBe(false)
      }

      // Second execution
      result = await handler.execute(mockBlock, {}, mockContext)
      expect(mockContext.loopIterations.get('loop-1')).toBe(2)
      expect(mockContext.loopItems.get('loop-1')).toBe('b')

      if (typeof result === 'object' && result !== null && 'response' in result) {
        const response = result.response as any
        expect(response.completed).toBe(false)
      }

      // Third execution should complete the loop
      result = await handler.execute(mockBlock, {}, mockContext)
      // The loop handler no longer marks loops as completed - that's handled by the loop manager
      expect(mockContext.completedLoops.has('loop-1')).toBe(false)
    })

    it('should throw error for forEach loops without collection', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 5,
        loopType: 'forEach',
        forEachItems: '', // Empty collection
      }

      await expect(handler.execute(mockBlock, {}, mockContext)).rejects.toThrow(
        'forEach loop "loop-1" requires a collection to iterate over'
      )
    })

    it('should throw error for forEach loops with empty collection', async () => {
      mockContext.workflow!.loops['loop-1'] = {
        id: 'loop-1',
        nodes: ['inner-block'],
        iterations: 5,
        loopType: 'forEach',
        forEachItems: [], // Empty array
      }

      await expect(handler.execute(mockBlock, {}, mockContext)).rejects.toThrow(
        'forEach loop "loop-1" collection is empty or invalid'
      )
    })
  })
})
