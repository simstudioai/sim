import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { PathTracker } from '@/executor/path/path'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Parallel Block Activation Regression Tests', () => {
  let pathTracker: PathTracker
  let mockContext: ExecutionContext

  const createMockContext = (workflow: SerializedWorkflow): ExecutionContext => ({
    workflowId: 'test-workflow',
    blockStates: new Map(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopIterations: new Map(),
    loopItems: new Map(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(['start']),
    completedLoops: new Set(),
    workflow,
  })

  describe('Original Bug: Agent → Parallel should work', () => {
    beforeEach(() => {
      // The exact scenario from the user's non-working workflow
      const workflow: SerializedWorkflow = {
        version: '2.0',
        blocks: [
          {
            id: 'start',
            metadata: { id: BlockType.STARTER, name: 'Start' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.STARTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent-1',
            metadata: { id: BlockType.AGENT, name: 'Agent 1' },
            position: { x: 200, y: 0 },
            config: { tool: BlockType.AGENT, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'parallel-1',
            metadata: { id: BlockType.PARALLEL, name: 'Parallel 1' },
            position: { x: 400, y: 0 },
            config: { tool: BlockType.PARALLEL, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent-2',
            metadata: { id: BlockType.AGENT, name: 'Agent 2' },
            position: { x: 600, y: 0 },
            config: { tool: BlockType.AGENT, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'start', target: 'agent-1' },
          { source: 'agent-1', target: 'parallel-1' }, // This was broken!
          { source: 'parallel-1', target: 'agent-2', sourceHandle: 'parallel-start-source' },
        ],
        loops: {},
        parallels: {
          'parallel-1': {
            id: 'parallel-1',
            nodes: ['agent-2'],
            count: 3,
            parallelType: 'count',
          },
        },
      }

      pathTracker = new PathTracker(workflow)
      mockContext = createMockContext(workflow)
    })

    it('should allow agent to activate parallel block', () => {
      // Agent 1 executes successfully
      mockContext.blockStates.set('agent-1', {
        output: { content: 'Agent response', usage: { tokens: 100 } },
        executed: true,
        executionTime: 1000,
      })
      mockContext.executedBlocks.add('agent-1')
      mockContext.activeExecutionPath.add('agent-1')

      // Update paths after agent execution
      pathTracker.updateExecutionPaths(['agent-1'], mockContext)

      // ✅ The parallel block should be activated
      expect(mockContext.activeExecutionPath.has('parallel-1')).toBe(true)
    })

    it('should not activate parallel-start-source connections during path updates', () => {
      // Set up parallel block as executed
      mockContext.blockStates.set('parallel-1', {
        output: { parallelId: 'parallel-1', parallelCount: 3, started: true },
        executed: true,
        executionTime: 100,
      })
      mockContext.executedBlocks.add('parallel-1')
      mockContext.activeExecutionPath.add('parallel-1')

      // Update paths after parallel execution
      pathTracker.updateExecutionPaths(['parallel-1'], mockContext)

      // ✅ The child agent should NOT be activated via PathTracker (parallel handler manages this)
      expect(mockContext.activeExecutionPath.has('agent-2')).toBe(false)
    })
  })

  describe('Regression: Router → Parallel should still work', () => {
    beforeEach(() => {
      // The working scenario that should continue to work
      const workflow: SerializedWorkflow = {
        version: '2.0',
        blocks: [
          {
            id: 'start',
            metadata: { id: BlockType.STARTER, name: 'Start' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.STARTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'router-1',
            metadata: { id: BlockType.ROUTER, name: 'Router 1' },
            position: { x: 200, y: 0 },
            config: { tool: BlockType.ROUTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'parallel-1',
            metadata: { id: BlockType.PARALLEL, name: 'Parallel 1' },
            position: { x: 400, y: 0 },
            config: { tool: BlockType.PARALLEL, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'function-1',
            metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
            position: { x: 600, y: 0 },
            config: { tool: BlockType.FUNCTION, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'start', target: 'router-1' },
          { source: 'router-1', target: 'parallel-1' },
          { source: 'parallel-1', target: 'function-1', sourceHandle: 'parallel-start-source' },
        ],
        loops: {},
        parallels: {
          'parallel-1': {
            id: 'parallel-1',
            nodes: ['function-1'],
            count: 2,
            parallelType: 'count',
          },
        },
      }

      pathTracker = new PathTracker(workflow)
      mockContext = createMockContext(workflow)
    })

    it('should allow router to activate parallel block', () => {
      // Router executes and selects parallel
      mockContext.blockStates.set('router-1', {
        output: {
          selectedPath: { blockId: 'parallel-1', blockType: BlockType.PARALLEL },
          reasoning: 'Going to parallel',
        },
        executed: true,
        executionTime: 500,
      })
      mockContext.executedBlocks.add('router-1')
      mockContext.activeExecutionPath.add('router-1')

      // Update paths after router execution
      pathTracker.updateExecutionPaths(['router-1'], mockContext)

      // ✅ Router should activate parallel block
      expect(mockContext.activeExecutionPath.has('parallel-1')).toBe(true)
    })
  })

  describe('Regression: Condition → Parallel should still work', () => {
    beforeEach(() => {
      const workflow: SerializedWorkflow = {
        version: '2.0',
        blocks: [
          {
            id: 'start',
            metadata: { id: BlockType.STARTER, name: 'Start' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.STARTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'condition-1',
            metadata: { id: BlockType.CONDITION, name: 'Condition 1' },
            position: { x: 200, y: 0 },
            config: { tool: BlockType.CONDITION, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'parallel-1',
            metadata: { id: BlockType.PARALLEL, name: 'Parallel 1' },
            position: { x: 400, y: 0 },
            config: { tool: BlockType.PARALLEL, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'function-1',
            metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
            position: { x: 400, y: 200 },
            config: { tool: BlockType.FUNCTION, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent-1',
            metadata: { id: BlockType.AGENT, name: 'Agent 1' },
            position: { x: 600, y: 0 },
            config: { tool: BlockType.AGENT, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'start', target: 'condition-1' },
          { source: 'condition-1', target: 'parallel-1', sourceHandle: 'condition-if' },
          { source: 'condition-1', target: 'function-1', sourceHandle: 'condition-else' },
          { source: 'parallel-1', target: 'agent-1', sourceHandle: 'parallel-start-source' },
        ],
        loops: {},
        parallels: {
          'parallel-1': {
            id: 'parallel-1',
            nodes: ['agent-1'],
            count: 2,
            parallelType: 'count',
          },
        },
      }

      pathTracker = new PathTracker(workflow)
      mockContext = createMockContext(workflow)
    })

    it('should allow condition to activate parallel block when if condition is met', () => {
      // Condition executes and selects if path (parallel)
      mockContext.blockStates.set('condition-1', {
        output: {
          selectedConditionId: 'if',
          conditionResult: true,
          selectedPath: { blockId: 'parallel-1', blockType: BlockType.PARALLEL },
        },
        executed: true,
        executionTime: 200,
      })
      mockContext.executedBlocks.add('condition-1')
      mockContext.activeExecutionPath.add('condition-1')

      // Update paths after condition execution
      pathTracker.updateExecutionPaths(['condition-1'], mockContext)

      // ✅ Condition should activate parallel block
      expect(mockContext.activeExecutionPath.has('parallel-1')).toBe(true)
      // ✅ Function should NOT be activated (else path)
      expect(mockContext.activeExecutionPath.has('function-1')).toBe(false)
    })

    it('should allow condition to activate function block when else condition is met', () => {
      // Condition executes and selects else path (function)
      mockContext.blockStates.set('condition-1', {
        output: {
          selectedConditionId: 'else',
          conditionResult: false,
          selectedPath: { blockId: 'function-1', blockType: BlockType.FUNCTION },
        },
        executed: true,
        executionTime: 200,
      })
      mockContext.executedBlocks.add('condition-1')
      mockContext.activeExecutionPath.add('condition-1')

      // Update paths after condition execution
      pathTracker.updateExecutionPaths(['condition-1'], mockContext)

      // ✅ Function should be activated (else path)
      expect(mockContext.activeExecutionPath.has('function-1')).toBe(true)
      // ✅ Parallel should NOT be activated (if path)
      expect(mockContext.activeExecutionPath.has('parallel-1')).toBe(false)
    })
  })

  describe('Regression: All regular blocks should activate parallel/loop', () => {
    it.each([
      { blockType: BlockType.FUNCTION, name: 'Function' },
      { blockType: BlockType.AGENT, name: 'Agent' },
      { blockType: BlockType.API, name: 'API' },
      { blockType: BlockType.EVALUATOR, name: 'Evaluator' },
      { blockType: BlockType.RESPONSE, name: 'Response' },
      { blockType: BlockType.WORKFLOW, name: 'Workflow' },
    ])('should allow $name → Parallel activation', ({ blockType, name }) => {
      const workflow: SerializedWorkflow = {
        version: '2.0',
        blocks: [
          {
            id: 'start',
            metadata: { id: BlockType.STARTER, name: 'Start' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.STARTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'regular-block',
            metadata: { id: blockType, name },
            position: { x: 200, y: 0 },
            config: { tool: blockType, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'parallel-1',
            metadata: { id: BlockType.PARALLEL, name: 'Parallel 1' },
            position: { x: 400, y: 0 },
            config: { tool: BlockType.PARALLEL, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'target-function',
            metadata: { id: BlockType.FUNCTION, name: 'Target Function' },
            position: { x: 600, y: 0 },
            config: { tool: BlockType.FUNCTION, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'start', target: 'regular-block' },
          { source: 'regular-block', target: 'parallel-1' },
          {
            source: 'parallel-1',
            target: 'target-function',
            sourceHandle: 'parallel-start-source',
          },
        ],
        loops: {},
        parallels: {
          'parallel-1': {
            id: 'parallel-1',
            nodes: ['target-function'],
            count: 2,
            parallelType: 'count',
          },
        },
      }

      pathTracker = new PathTracker(workflow)
      mockContext = createMockContext(workflow)

      // Regular block executes
      mockContext.blockStates.set('regular-block', {
        output: { result: 'Success' },
        executed: true,
        executionTime: 100,
      })
      mockContext.executedBlocks.add('regular-block')
      mockContext.activeExecutionPath.add('regular-block')

      // Update paths after regular block execution
      pathTracker.updateExecutionPaths(['regular-block'], mockContext)

      // ✅ The parallel block should be activated
      expect(mockContext.activeExecutionPath.has('parallel-1')).toBe(true)
    })
  })

  describe('Regression: Internal flow control connections should still be blocked', () => {
    it('should prevent activation of parallel-start-source connections during selective activation', () => {
      const workflow: SerializedWorkflow = {
        version: '2.0',
        blocks: [
          {
            id: 'function-1',
            metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.FUNCTION, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent-1',
            metadata: { id: BlockType.AGENT, name: 'Agent 1' },
            position: { x: 200, y: 0 },
            config: { tool: BlockType.AGENT, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          // This is an internal flow control connection that should be blocked
          { source: 'function-1', target: 'agent-1', sourceHandle: 'parallel-start-source' },
        ],
        loops: {},
        parallels: {},
      }

      pathTracker = new PathTracker(workflow)
      mockContext = createMockContext(workflow)

      // Function 1 executes
      mockContext.blockStates.set('function-1', {
        output: { result: 'Success' },
        executed: true,
        executionTime: 100,
      })
      mockContext.executedBlocks.add('function-1')
      mockContext.activeExecutionPath.add('function-1')

      // Update paths after function execution
      pathTracker.updateExecutionPaths(['function-1'], mockContext)

      // ❌ Agent should NOT be activated via parallel-start-source during selective activation
      expect(mockContext.activeExecutionPath.has('agent-1')).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle loop blocks the same way as parallel blocks', () => {
      const workflow: SerializedWorkflow = {
        version: '2.0',
        blocks: [
          {
            id: 'start',
            metadata: { id: BlockType.STARTER, name: 'Start' },
            position: { x: 0, y: 0 },
            config: { tool: BlockType.STARTER, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'function-1',
            metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
            position: { x: 200, y: 0 },
            config: { tool: BlockType.FUNCTION, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'loop-1',
            metadata: { id: BlockType.LOOP, name: 'Loop 1' },
            position: { x: 400, y: 0 },
            config: { tool: BlockType.LOOP, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent-1',
            metadata: { id: BlockType.AGENT, name: 'Agent 1' },
            position: { x: 600, y: 0 },
            config: { tool: BlockType.AGENT, params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'start', target: 'function-1' },
          { source: 'function-1', target: 'loop-1' }, // Function → Loop should work
          { source: 'loop-1', target: 'agent-1', sourceHandle: 'loop-start-source' },
        ],
        loops: {
          'loop-1': {
            id: 'loop-1',
            nodes: ['agent-1'],
            iterations: 3,
            loopType: 'for',
          },
        },
        parallels: {},
      }

      pathTracker = new PathTracker(workflow)
      mockContext = createMockContext(workflow)

      // Function 1 executes
      mockContext.blockStates.set('function-1', {
        output: { result: 'Success' },
        executed: true,
        executionTime: 100,
      })
      mockContext.executedBlocks.add('function-1')
      mockContext.activeExecutionPath.add('function-1')

      // Update paths after function execution
      pathTracker.updateExecutionPaths(['function-1'], mockContext)

      // ✅ Function should be able to activate loop block
      expect(mockContext.activeExecutionPath.has('loop-1')).toBe(true)
    })
  })
})
