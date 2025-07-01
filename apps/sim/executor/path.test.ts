import { beforeEach, describe, expect, it } from 'vitest'
import type { SerializedWorkflow } from '@/serializer/types'
import { PathTracker } from './path'
import type { BlockState, ExecutionContext } from './types'

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
          metadata: { id: 'router' },
          position: { x: 0, y: 0 },
          config: { tool: 'router', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'condition1',
          metadata: { id: 'condition' },
          position: { x: 0, y: 0 },
          config: { tool: 'condition', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'loop1',
          metadata: { id: 'loop' },
          position: { x: 0, y: 0 },
          config: { tool: 'loop', params: {} },
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
          output: { response: { selectedPath: { blockId: 'block1' } } },
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
          output: { response: {} },
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
          output: { response: { selectedConditionId: 'if' } },
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
          output: { response: { selectedConditionId: 'unknown' } },
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
          output: { response: { data: 'success' } },
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
          output: { error: 'Something failed', response: { error: 'Something failed' } },
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
        output: { response: { data: 'success' } },
        executed: true,
        executionTime: 100,
      }
      const blockState2: BlockState = {
        output: { response: { selectedPath: { blockId: 'block1' } } },
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
            metadata: { id: 'router', name: 'Router' },
            position: { x: 0, y: 0 },
            config: { tool: 'router', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'api1',
            metadata: { id: 'api', name: 'API 1' },
            position: { x: 0, y: 0 },
            config: { tool: 'api', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'api2',
            metadata: { id: 'api', name: 'API 2' },
            position: { x: 0, y: 0 },
            config: { tool: 'api', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent1',
            metadata: { id: 'agent', name: 'Agent' },
            position: { x: 0, y: 0 },
            config: { tool: 'agent', params: {} },
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
      // Mock router output selecting api1
      mockContext.blockStates.set('router1', {
        output: {
          response: {
            selectedPath: {
              blockId: 'api1',
              blockType: 'api',
              blockTitle: 'API 1',
            },
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
        metadata: { id: 'api', name: 'Final Step' },
        position: { x: 0, y: 0 },
        config: { tool: 'api', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      })
      mockWorkflow.connections.push({ source: 'agent1', target: 'finalStep' })

      pathTracker = new PathTracker(mockWorkflow)

      // Mock router output selecting api1
      mockContext.blockStates.set('router1', {
        output: {
          response: {
            selectedPath: {
              blockId: 'api1',
              blockType: 'api',
              blockTitle: 'API 1',
            },
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
          response: {
            selectedPath: {
              blockId: 'api1',
              blockType: 'api',
              blockTitle: 'API 1',
            },
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
          response: {
            selectedPath: {
              blockId: 'api1',
              blockType: 'api',
              blockTitle: 'API 1',
            },
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
})
