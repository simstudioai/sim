import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { PathTracker } from '@/executor/path/path'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Nested Routing Fix - Router → Condition → Target', () => {
  let workflow: SerializedWorkflow
  let pathTracker: PathTracker
  let mockContext: ExecutionContext

  beforeEach(() => {
    // Create a workflow similar to the screenshot: Router → Condition → Function/Parallel
    workflow = {
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
          id: 'router-1',
          position: { x: 100, y: 0 },
          metadata: { id: BlockType.ROUTER, name: 'Router 1' },
          config: { tool: BlockType.ROUTER, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-2',
          position: { x: 200, y: -100 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 2' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'condition-1',
          position: { x: 200, y: 100 },
          metadata: { id: BlockType.CONDITION, name: 'Condition 1' },
          config: { tool: BlockType.CONDITION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-4',
          position: { x: 350, y: 50 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 4' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'parallel-block',
          position: { x: 350, y: 150 },
          metadata: { id: BlockType.PARALLEL, name: 'Parallel Block' },
          config: { tool: BlockType.PARALLEL, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'agent-inside-parallel',
          position: { x: 450, y: 150 },
          metadata: { id: BlockType.AGENT, name: 'Agent Inside Parallel' },
          config: { tool: BlockType.AGENT, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        { source: 'starter', target: 'router-1' },
        { source: 'router-1', target: 'function-2' },
        { source: 'router-1', target: 'condition-1' },
        {
          source: 'condition-1',
          target: 'function-4',
          sourceHandle: 'condition-b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-if',
        },
        {
          source: 'condition-1',
          target: 'parallel-block',
          sourceHandle: 'condition-b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-else',
        },
        {
          source: 'parallel-block',
          target: 'agent-inside-parallel',
          sourceHandle: 'parallel-start-source',
        },
      ],
      loops: {},
      parallels: {
        'parallel-block': {
          id: 'parallel-block',
          nodes: ['agent-inside-parallel'],
          distribution: ['item1', 'item2'],
        },
      },
    }

    pathTracker = new PathTracker(workflow)

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
      workflow,
    }

    // Initialize starter as executed and in active path
    mockContext.executedBlocks.add('starter')
    mockContext.activeExecutionPath.add('starter')
    mockContext.activeExecutionPath.add('router-1')
  })

  it('should handle nested routing: router selects condition, condition selects function', () => {
    // Step 1: Router selects the condition path (not function-2)
    mockContext.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'condition-1',
          blockType: BlockType.CONDITION,
          blockTitle: 'Condition 1',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-1')

    // Update paths after router execution
    pathTracker.updateExecutionPaths(['router-1'], mockContext)

    // Verify router decision
    expect(mockContext.decisions.router.get('router-1')).toBe('condition-1')

    // After router execution, condition should be active but not function-2
    expect(mockContext.activeExecutionPath.has('condition-1')).toBe(true)
    expect(mockContext.activeExecutionPath.has('function-2')).toBe(false)

    // CRITICAL: Parallel block should NOT be activated yet
    expect(mockContext.activeExecutionPath.has('parallel-block')).toBe(false)
    expect(mockContext.activeExecutionPath.has('agent-inside-parallel')).toBe(false)

    // Step 2: Condition executes and selects function-4 (not parallel)
    mockContext.blockStates.set('condition-1', {
      output: {
        result: 'two',
        stdout: '',
        conditionResult: true,
        selectedPath: {
          blockId: 'function-4',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 4',
        },
        selectedConditionId: 'b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-if',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('condition-1')

    // Update paths after condition execution
    pathTracker.updateExecutionPaths(['condition-1'], mockContext)

    // Verify condition decision
    expect(mockContext.decisions.condition.get('condition-1')).toBe(
      'b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-if'
    )

    // After condition execution, function-4 should be active
    expect(mockContext.activeExecutionPath.has('function-4')).toBe(true)

    // CRITICAL: Parallel block should still NOT be activated
    expect(mockContext.activeExecutionPath.has('parallel-block')).toBe(false)
    expect(mockContext.activeExecutionPath.has('agent-inside-parallel')).toBe(false)
  })

  it('should handle nested routing: router selects condition, condition selects parallel', () => {
    // Step 1: Router selects the condition path
    mockContext.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'condition-1',
          blockType: BlockType.CONDITION,
          blockTitle: 'Condition 1',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-1')

    pathTracker.updateExecutionPaths(['router-1'], mockContext)

    // Step 2: Condition executes and selects parallel-block (not function-4)
    mockContext.blockStates.set('condition-1', {
      output: {
        result: 'else',
        stdout: '',
        conditionResult: false,
        selectedPath: {
          blockId: 'parallel-block',
          blockType: BlockType.PARALLEL,
          blockTitle: 'Parallel Block',
        },
        selectedConditionId: 'b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-else',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('condition-1')

    pathTracker.updateExecutionPaths(['condition-1'], mockContext)

    // Verify condition decision
    expect(mockContext.decisions.condition.get('condition-1')).toBe(
      'b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-else'
    )

    // After condition execution, parallel-block should be active
    expect(mockContext.activeExecutionPath.has('parallel-block')).toBe(true)

    // Function-4 should NOT be activated
    expect(mockContext.activeExecutionPath.has('function-4')).toBe(false)

    // The agent inside parallel should NOT be automatically activated
    // It should only be activated when the parallel block executes
    expect(mockContext.activeExecutionPath.has('agent-inside-parallel')).toBe(false)
  })

  it('should prevent parallel blocks from executing when not selected by nested routing', () => {
    // This test simulates the exact scenario from the bug report

    // Step 1: Router selects condition path
    mockContext.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'condition-1',
          blockType: BlockType.CONDITION,
          blockTitle: 'Condition 1',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-1')
    pathTracker.updateExecutionPaths(['router-1'], mockContext)

    // Step 2: Condition selects function-4 (NOT parallel)
    mockContext.blockStates.set('condition-1', {
      output: {
        result: 'two',
        stdout: '',
        conditionResult: true,
        selectedPath: {
          blockId: 'function-4',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 4',
        },
        selectedConditionId: 'b8f0a33c-a57f-4a36-ac7a-dc9f2b5e6c07-if',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('condition-1')
    pathTracker.updateExecutionPaths(['condition-1'], mockContext)

    // Step 3: Simulate what the executor's getNextExecutionLayer would do
    const blocksToExecute = workflow.blocks.filter(
      (block) =>
        mockContext.activeExecutionPath.has(block.id) && !mockContext.executedBlocks.has(block.id)
    )

    const blockIds = blocksToExecute.map((b) => b.id)

    // Should only include function-4, NOT parallel-block
    expect(blockIds).toContain('function-4')
    expect(blockIds).not.toContain('parallel-block')
    expect(blockIds).not.toContain('agent-inside-parallel')

    // Verify that parallel block is not in active path
    expect(mockContext.activeExecutionPath.has('parallel-block')).toBe(false)

    // Verify that isInActivePath also returns false for parallel block
    const isParallelActive = pathTracker.isInActivePath('parallel-block', mockContext)
    expect(isParallelActive).toBe(false)
  })
})
