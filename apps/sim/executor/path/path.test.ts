import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { PathTracker } from '@/executor/path/path'
import { Routing } from '@/executor/routing/routing'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

describe('PathTracker', () => {
  let pathTracker: PathTracker
  let mockWorkflow: SerializedWorkflow
  let mockContext: ExecutionContext

  beforeEach(() => {
    mockWorkflow = {
      version: '1.0',
      blocks: [
        {
          id: 'block1',
          metadata: { id: 'generic' },
          position: { x: 0, y: 0 },
          config: { tool: 'generic', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'block2',
          metadata: { id: 'generic' },
          position: { x: 0, y: 0 },
          config: { tool: 'generic', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'router1',
          metadata: { id: BlockType.ROUTER },
          position: { x: 0, y: 0 },
          config: { tool: BlockType.ROUTER, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'condition1',
          metadata: { id: BlockType.CONDITION },
          position: { x: 0, y: 0 },
          config: { tool: BlockType.CONDITION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'loop1',
          metadata: { id: BlockType.LOOP },
          position: { x: 0, y: 0 },
          config: { tool: BlockType.LOOP, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        { source: 'block1', target: 'block2' },
        { source: 'router1', target: 'block1' },
        { source: 'router1', target: 'block2' },
        { source: 'condition1', target: 'block1', sourceHandle: 'condition-if' },
        { source: 'condition1', target: 'block2', sourceHandle: 'condition-else' },
        { source: 'loop1', target: 'block1', sourceHandle: 'loop-start-source' },
        { source: 'loop1', target: 'block2', sourceHandle: 'loop-end-source' },
      ],
      loops: {
        loop1: {
          id: 'loop1',
          nodes: ['block1'],
          iterations: 3,
          loopType: 'for',
        },
      },
      parallels: {},
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
      workflow: mockWorkflow,
    }

    pathTracker = new PathTracker(mockWorkflow)
  })

  describe('isInActivePath', () => {
    it('should return true if block is already in active path', () => {
      mockContext.activeExecutionPath.add('block1')
      expect(pathTracker.isInActivePath('block1', mockContext)).toBe(true)
    })

    it('should return false if block has no incoming connections and is not in active path', () => {
      expect(pathTracker.isInActivePath('router1', mockContext)).toBe(false)
    })

    describe('regular blocks', () => {
      it('should return true if source block is in active path and executed', () => {
        mockContext.activeExecutionPath.add('block1')
        mockContext.executedBlocks.add('block1')
        expect(pathTracker.isInActivePath('block2', mockContext)).toBe(true)
      })

      it('should return false if source block is not executed', () => {
        mockContext.activeExecutionPath.add('block1')
        expect(pathTracker.isInActivePath('block2', mockContext)).toBe(false)
      })

      it('should return false if source block is not in active path', () => {
        mockContext.executedBlocks.add('block1')
        expect(pathTracker.isInActivePath('block2', mockContext)).toBe(false)
      })
    })

    describe('router blocks', () => {
      it('should return true if router selected this target', () => {
        mockContext.executedBlocks.add('router1')
        mockContext.decisions.router.set('router1', 'block1')
        expect(pathTracker.isInActivePath('block1', mockContext)).toBe(true)
      })

      it('should return false if router selected different target', () => {
        mockContext.executedBlocks.add('router1')
        mockContext.decisions.router.set('router1', 'block2')
        expect(pathTracker.isInActivePath('block1', mockContext)).toBe(false)
      })

      it('should return false if router not executed', () => {
        mockContext.decisions.router.set('router1', 'block1')
        expect(pathTracker.isInActivePath('block1', mockContext)).toBe(false)
      })
    })

    describe('condition blocks', () => {
      it('should return true if condition selected this path', () => {
        mockContext.executedBlocks.add('condition1')
        mockContext.decisions.condition.set('condition1', 'if')
        expect(pathTracker.isInActivePath('block1', mockContext)).toBe(true)
      })

      it('should return false if condition selected different path', () => {
        mockContext.executedBlocks.add('condition1')
        mockContext.decisions.condition.set('condition1', 'else')
        expect(pathTracker.isInActivePath('block1', mockContext)).toBe(false)
      })

      it('should return false if connection has no sourceHandle', () => {
        // Add a connection without sourceHandle
        mockWorkflow.connections.push({ source: 'condition1', target: 'block3' })
        mockContext.executedBlocks.add('condition1')
        expect(pathTracker.isInActivePath('block3', mockContext)).toBe(false)
      })
    })
  })

  describe('updateExecutionPaths', () => {
    describe('router blocks', () => {
      it('should update router decision and activate selected path', () => {
        const blockState: BlockState = {
          output: { selectedPath: { blockId: 'block1' } },
          executed: true,
          executionTime: 100,
        }
        mockContext.blockStates.set('router1', blockState)

        pathTracker.updateExecutionPaths(['router1'], mockContext)

        expect(mockContext.decisions.router.get('router1')).toBe('block1')
        expect(mockContext.activeExecutionPath.has('block1')).toBe(true)
      })

      it('should not update if no selected path', () => {
        const blockState: BlockState = {
          output: {},
          executed: true,
          executionTime: 100,
        }
        mockContext.blockStates.set('router1', blockState)

        pathTracker.updateExecutionPaths(['router1'], mockContext)

        expect(mockContext.decisions.router.has('router1')).toBe(false)
        expect(mockContext.activeExecutionPath.has('block1')).toBe(false)
      })
    })

    describe('condition blocks', () => {
      it('should update condition decision and activate selected connection', () => {
        const blockState: BlockState = {
          output: { selectedConditionId: 'if' },
          executed: true,
          executionTime: 100,
        }
        mockContext.blockStates.set('condition1', blockState)

        pathTracker.updateExecutionPaths(['condition1'], mockContext)

        expect(mockContext.decisions.condition.get('condition1')).toBe('if')
        expect(mockContext.activeExecutionPath.has('block1')).toBe(true)
      })

      it('should not activate if no matching connection', () => {
        const blockState: BlockState = {
          output: { selectedConditionId: 'unknown' },
          executed: true,
          executionTime: 100,
        }
        mockContext.blockStates.set('condition1', blockState)

        pathTracker.updateExecutionPaths(['condition1'], mockContext)

        expect(mockContext.decisions.condition.get('condition1')).toBe('unknown')
        expect(mockContext.activeExecutionPath.has('block1')).toBe(false)
      })
    })

    describe('loop blocks', () => {
      it('should only activate loop-start connections', () => {
        pathTracker.updateExecutionPaths(['loop1'], mockContext)

        expect(mockContext.activeExecutionPath.has('block1')).toBe(true)
        expect(mockContext.activeExecutionPath.has('block2')).toBe(false)
      })
    })

    describe('regular blocks', () => {
      it('should activate outgoing connections on success', () => {
        const blockState: BlockState = {
          output: { data: 'success' },
          executed: true,
          executionTime: 100,
        }
        mockContext.blockStates.set('block1', blockState)
        mockContext.executedBlocks.add('block1')
        // Complete the loop so external connections can be activated
        mockContext.completedLoops.add('loop1')

        pathTracker.updateExecutionPaths(['block1'], mockContext)

        expect(mockContext.activeExecutionPath.has('block2')).toBe(true)
      })

      it('should activate error connections on error', () => {
        // Add error connection
        mockWorkflow.connections.push({
          source: 'block1',
          target: 'errorHandler',
          sourceHandle: 'error',
        })
        const blockState: BlockState = {
          output: { error: 'Something failed' },
          executed: true,
          executionTime: 100,
        }
        mockContext.blockStates.set('block1', blockState)
        mockContext.executedBlocks.add('block1')
        // Complete the loop so external connections can be activated
        mockContext.completedLoops.add('loop1')

        pathTracker.updateExecutionPaths(['block1'], mockContext)

        expect(mockContext.activeExecutionPath.has('errorHandler')).toBe(true)
        expect(mockContext.activeExecutionPath.has('block2')).toBe(false)
      })

      it('should skip external loop connections if loop not completed', () => {
        // Add block3 outside the loop
        mockWorkflow.blocks.push({
          id: 'block3',
          metadata: { id: 'generic' },
          position: { x: 0, y: 0 },
          config: { tool: 'generic', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        })
        mockWorkflow.connections.push({ source: 'block1', target: 'block3' })
        mockContext.executedBlocks.add('block1')

        pathTracker.updateExecutionPaths(['block1'], mockContext)

        expect(mockContext.activeExecutionPath.has('block3')).toBe(false)
      })

      it('should activate external loop connections if loop completed', () => {
        // Add block3 outside the loop
        mockWorkflow.blocks.push({
          id: 'block3',
          metadata: { id: 'generic' },
          position: { x: 0, y: 0 },
          config: { tool: 'generic', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        })
        mockWorkflow.connections.push({ source: 'block1', target: 'block3' })
        mockContext.completedLoops.add('loop1')
        mockContext.executedBlocks.add('block1')

        pathTracker.updateExecutionPaths(['block1'], mockContext)

        expect(mockContext.activeExecutionPath.has('block3')).toBe(true)
      })

      it('should activate all other connection types', () => {
        // Add custom connection type
        mockWorkflow.connections.push({
          source: 'block1',
          target: 'customHandler',
          sourceHandle: 'custom-handle',
        })
        mockContext.executedBlocks.add('block1')
        // Complete the loop so external connections can be activated
        mockContext.completedLoops.add('loop1')

        pathTracker.updateExecutionPaths(['block1'], mockContext)

        expect(mockContext.activeExecutionPath.has('customHandler')).toBe(true)
      })
    })

    it('should handle multiple blocks in one update', () => {
      const blockState1: BlockState = {
        output: { data: 'success' },
        executed: true,
        executionTime: 100,
      }
      const blockState2: BlockState = {
        output: { selectedPath: { blockId: 'block1' } },
        executed: true,
        executionTime: 150,
      }
      mockContext.blockStates.set('block1', blockState1)
      mockContext.blockStates.set('router1', blockState2)
      mockContext.executedBlocks.add('block1')
      mockContext.executedBlocks.add('router1')
      // Complete the loop so block1 can activate external connections
      mockContext.completedLoops.add('loop1')

      pathTracker.updateExecutionPaths(['block1', 'router1'], mockContext)

      expect(mockContext.activeExecutionPath.has('block2')).toBe(true)
      expect(mockContext.activeExecutionPath.has('block1')).toBe(true)
      expect(mockContext.decisions.router.get('router1')).toBe('block1')
    })

    it('should skip blocks that do not exist', () => {
      // Should not throw
      expect(() => {
        pathTracker.updateExecutionPaths(['nonexistent'], mockContext)
      }).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle blocks with multiple incoming connections', () => {
      // Add another connection to block2
      mockWorkflow.connections.push({ source: 'router1', target: 'block2' })

      // One path is active
      mockContext.activeExecutionPath.add('block1')
      mockContext.executedBlocks.add('block1')

      expect(pathTracker.isInActivePath('block2', mockContext)).toBe(true)
    })

    it('should handle nested loops', () => {
      // Add nested loop
      mockWorkflow.loops = mockWorkflow.loops || {}
      mockWorkflow.loops.loop2 = {
        id: 'loop2',
        nodes: ['loop1', 'block1'],
        iterations: 2,
        loopType: 'for',
      }

      // Block1 is in both loops
      const loops = Object.entries(mockContext.workflow?.loops || {})
        .filter(([_, loop]) => loop.nodes.includes('block1'))
        .map(([id, loop]) => ({ id, loop }))

      expect(loops).toHaveLength(2)
    })

    it('should handle empty workflow', () => {
      const emptyWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [],
        connections: [],
        loops: {},
      }
      const emptyTracker = new PathTracker(emptyWorkflow)

      expect(emptyTracker.isInActivePath('any', mockContext)).toBe(false)
      expect(() => {
        emptyTracker.updateExecutionPaths(['any'], mockContext)
      }).not.toThrow()
    })
  })

  describe('Router downstream path activation', () => {
    beforeEach(() => {
      // Create router workflow with downstream connections
      mockWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'router1',
            metadata: { id: BlockType.ROUTER, name: 'Router' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.ROUTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'api1',
            metadata: { id: BlockType.API, name: 'API 1' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.API, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'api2',
            metadata: { id: BlockType.API, name: 'API 2' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.API, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent1',
            metadata: { id: BlockType.AGENT, name: 'Agent' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.AGENT, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'router1', target: 'api1' },
          { source: 'router1', target: 'api2' },
          { source: 'api1', target: 'agent1' },
          { source: 'api2', target: 'agent1' },
        ],
        loops: {},
        parallels: {},
      }

      pathTracker = new PathTracker(mockWorkflow)
      mockContext = {
        workflowId: 'test-router-workflow',
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
        workflow: mockWorkflow,
      }
    })

    it('should activate downstream paths when router selects a target', () => {
      // Mock router output selecting api1 - based on implementation, it expects selectedPath directly
      mockContext.blockStates.set('router1', {
        output: {
          selectedPath: {
            blockId: 'api1',
            blockType: BlockType.API,
            blockTitle: 'API 1',
          },
        },
        executed: true,
        executionTime: 100,
      })

      // Update paths for router
      pathTracker.updateExecutionPaths(['router1'], mockContext)

      // Both api1 and agent1 should be activated (downstream from api1)
      expect(mockContext.activeExecutionPath.has('api1')).toBe(true)
      expect(mockContext.activeExecutionPath.has('agent1')).toBe(true)

      // api2 should NOT be activated (not selected by router)
      expect(mockContext.activeExecutionPath.has('api2')).toBe(false)
    })

    it('should handle multiple levels of downstream connections', () => {
      // Add another level to test deep activation
      mockWorkflow.blocks.push({
        id: 'finalStep',
        metadata: { id: BlockType.API, name: 'Final Step' },
        position: { x: 0, y: 0 },
        config: { tool: BlockType.API, params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      })
      mockWorkflow.connections.push({ source: 'agent1', target: 'finalStep' })

      pathTracker = new PathTracker(mockWorkflow)

      // Mock router output selecting api1 - based on implementation, it expects selectedPath directly
      mockContext.blockStates.set('router1', {
        output: {
          selectedPath: {
            blockId: 'api1',
            blockType: BlockType.API,
            blockTitle: 'API 1',
          },
        },
        executed: true,
        executionTime: 100,
      })

      pathTracker.updateExecutionPaths(['router1'], mockContext)

      // All downstream blocks should be activated
      expect(mockContext.activeExecutionPath.has('api1')).toBe(true)
      expect(mockContext.activeExecutionPath.has('agent1')).toBe(true)
      expect(mockContext.activeExecutionPath.has('finalStep')).toBe(true)

      // Non-selected path should not be activated
      expect(mockContext.activeExecutionPath.has('api2')).toBe(false)
    })

    it('should not create infinite loops in cyclic workflows', () => {
      // Add a cycle to test loop prevention
      mockWorkflow.connections.push({ source: 'agent1', target: 'api1' })
      pathTracker = new PathTracker(mockWorkflow)

      mockContext.blockStates.set('router1', {
        output: {
          selectedPath: {
            blockId: 'api1',
            blockType: BlockType.API,
            blockTitle: 'API 1',
          },
        },
        executed: true,
        executionTime: 100,
      })

      // This should not throw or cause infinite recursion
      expect(() => {
        pathTracker.updateExecutionPaths(['router1'], mockContext)
      }).not.toThrow()

      // Both api1 and agent1 should still be activated
      expect(mockContext.activeExecutionPath.has('api1')).toBe(true)
      expect(mockContext.activeExecutionPath.has('agent1')).toBe(true)
    })

    it('should handle router with no downstream connections', () => {
      // Create isolated router
      const isolatedWorkflow = {
        ...mockWorkflow,
        connections: [
          { source: 'router1', target: 'api1' },
          { source: 'router1', target: 'api2' },
          // Remove downstream connections from api1/api2
        ],
      }
      pathTracker = new PathTracker(isolatedWorkflow)

      mockContext.blockStates.set('router1', {
        output: {
          selectedPath: {
            blockId: 'api1',
            blockType: BlockType.API,
            blockTitle: 'API 1',
          },
        },
        executed: true,
        executionTime: 100,
      })

      pathTracker.updateExecutionPaths(['router1'], mockContext)

      // Only the selected target should be activated
      expect(mockContext.activeExecutionPath.has('api1')).toBe(true)
      expect(mockContext.activeExecutionPath.has('api2')).toBe(false)
      expect(mockContext.activeExecutionPath.has('agent1')).toBe(false)
    })
  })

  describe('RoutingStrategy integration', () => {
    beforeEach(() => {
      // Add more block types to test the new routing strategy
      mockWorkflow.blocks.push(
        {
          id: 'parallel1',
          metadata: { id: BlockType.PARALLEL },
          position: { x: 0, y: 0 },
          config: { tool: BlockType.PARALLEL, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function1',
          metadata: { id: BlockType.FUNCTION },
          position: { x: 0, y: 0 },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'agent1',
          metadata: { id: BlockType.AGENT },
          position: { x: 0, y: 0 },
          config: { tool: BlockType.AGENT, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        }
      )

      mockWorkflow.connections.push(
        { source: 'parallel1', target: 'function1', sourceHandle: 'parallel-start-source' },
        { source: 'parallel1', target: 'agent1', sourceHandle: 'parallel-end-source' }
      )

      mockWorkflow.parallels = {
        parallel1: {
          id: 'parallel1',
          nodes: ['function1'],
          distribution: ['item1', 'item2'],
        },
      }

      pathTracker = new PathTracker(mockWorkflow)
    })

    it('should correctly categorize different block types', () => {
      // Test that our refactored code properly uses RoutingStrategy
      expect(Routing.getCategory(BlockType.ROUTER)).toBe('routing')
      expect(Routing.getCategory(BlockType.CONDITION)).toBe('routing')
      expect(Routing.getCategory(BlockType.PARALLEL)).toBe('flow-control')
      expect(Routing.getCategory(BlockType.LOOP)).toBe('flow-control')
      expect(Routing.getCategory(BlockType.FUNCTION)).toBe('regular')
      expect(Routing.getCategory(BlockType.AGENT)).toBe('regular')
    })

    it('should handle flow control blocks correctly in path checking', () => {
      // Test that parallel blocks are handled correctly
      mockContext.executedBlocks.add('parallel1')
      mockContext.activeExecutionPath.add('parallel1')

      // Function1 should be reachable from parallel1 via parallel-start-source
      expect(pathTracker.isInActivePath('function1', mockContext)).toBe(true)

      // Agent1 should be reachable from parallel1 via parallel-end-source
      expect(pathTracker.isInActivePath('agent1', mockContext)).toBe(true)
    })

    it('should handle router selecting routing blocks correctly', () => {
      // Test the refactored logic where router selects another routing block
      const blockState: BlockState = {
        output: { selectedPath: { blockId: 'condition1' } },
        executed: true,
        executionTime: 100,
      }
      mockContext.blockStates.set('router1', blockState)

      pathTracker.updateExecutionPaths(['router1'], mockContext)

      // Condition1 should be activated but not its downstream paths
      // (since routing blocks make their own decisions)
      expect(mockContext.activeExecutionPath.has('condition1')).toBe(true)
      expect(mockContext.decisions.router.get('router1')).toBe('condition1')
    })

    it('should handle router selecting flow control blocks correctly', () => {
      // Test the refactored logic where router selects a flow control block
      const blockState: BlockState = {
        output: { selectedPath: { blockId: 'parallel1' } },
        executed: true,
        executionTime: 100,
      }
      mockContext.blockStates.set('router1', blockState)

      pathTracker.updateExecutionPaths(['router1'], mockContext)

      // Parallel1 should be activated but not its downstream paths
      // (since flow control blocks don't activate downstream automatically)
      expect(mockContext.activeExecutionPath.has('parallel1')).toBe(true)
      expect(mockContext.decisions.router.get('router1')).toBe('parallel1')
      // Children should NOT be activated automatically
      expect(mockContext.activeExecutionPath.has('function1')).toBe(false)
      expect(mockContext.activeExecutionPath.has('agent1')).toBe(false)
    })

    it('should handle router selecting regular blocks correctly', () => {
      // Test that regular blocks still activate downstream paths
      const blockState: BlockState = {
        output: { selectedPath: { blockId: 'function1' } },
        executed: true,
        executionTime: 100,
      }
      mockContext.blockStates.set('router1', blockState)

      pathTracker.updateExecutionPaths(['router1'], mockContext)

      // Function1 should be activated and can activate downstream paths
      expect(mockContext.activeExecutionPath.has('function1')).toBe(true)
      expect(mockContext.decisions.router.get('router1')).toBe('function1')
    })

    it('should use category-based logic for updatePathForBlock', () => {
      // Test that the refactored switch statement works correctly

      // Test routing block (condition)
      const conditionState: BlockState = {
        output: { selectedConditionId: 'if' },
        executed: true,
        executionTime: 100,
      }
      mockContext.blockStates.set('condition1', conditionState)
      pathTracker.updateExecutionPaths(['condition1'], mockContext)
      expect(mockContext.decisions.condition.get('condition1')).toBe('if')

      // Test flow control block (loop)
      pathTracker.updateExecutionPaths(['loop1'], mockContext)
      expect(mockContext.activeExecutionPath.has('block1')).toBe(true) // loop-start-source

      // Test regular block
      const functionState: BlockState = {
        output: { result: 'success' },
        executed: true,
        executionTime: 100,
      }
      mockContext.blockStates.set('function1', functionState)
      mockContext.executedBlocks.add('function1')
      pathTracker.updateExecutionPaths(['function1'], mockContext)
      // Should activate downstream connections (handled by regular block logic)
    })
  })
})
