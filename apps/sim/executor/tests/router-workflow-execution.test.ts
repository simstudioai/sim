import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { PathTracker } from '@/executor/path/path'
import { Routing } from '@/executor/routing/routing'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Router → Workflow Block Execution Fix', () => {
  let workflow: SerializedWorkflow
  let pathTracker: PathTracker
  let mockContext: ExecutionContext

  beforeEach(() => {
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
          id: 'function-1',
          position: { x: 200, y: -100 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'router-2',
          position: { x: 200, y: 0 },
          metadata: { id: BlockType.ROUTER, name: 'Router 2' },
          config: { tool: BlockType.ROUTER, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-2',
          position: { x: 300, y: -50 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 2' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'workflow-2',
          position: { x: 300, y: 50 },
          metadata: { id: BlockType.WORKFLOW, name: 'Workflow 2' },
          config: { tool: BlockType.WORKFLOW, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        { source: 'starter', target: 'router-1' },
        { source: 'router-1', target: 'function-1' },
        { source: 'router-1', target: 'router-2' },
        { source: 'router-2', target: 'function-2' },
        { source: 'router-2', target: 'workflow-2' },
      ],
      loops: {},
      parallels: {},
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

  it('should categorize workflow blocks as flow control blocks requiring active path checks', () => {
    // Verify that workflow blocks now have the correct routing behavior
    expect(Routing.getCategory(BlockType.WORKFLOW)).toBe('flow-control')
    expect(Routing.requiresActivePathCheck(BlockType.WORKFLOW)).toBe(true)
    expect(Routing.shouldSkipInSelectiveActivation(BlockType.WORKFLOW)).toBe(true)
  })

  it('should prevent workflow blocks from executing when not selected by router', () => {
    // This test recreates the exact bug scenario from the CSV data

    // Step 1: Router 1 selects router-2 (not function-1)
    mockContext.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'router-2',
          blockType: BlockType.ROUTER,
          blockTitle: 'Router 2',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-1')

    // Update paths after router execution
    pathTracker.updateExecutionPaths(['router-1'], mockContext)

    // Verify router decision
    expect(mockContext.decisions.router.get('router-1')).toBe('router-2')

    // After router-1 execution, router-2 should be active but not function-1
    expect(mockContext.activeExecutionPath.has('router-2')).toBe(true)
    expect(mockContext.activeExecutionPath.has('function-1')).toBe(false)

    // CRITICAL: Workflow block should NOT be activated yet
    expect(mockContext.activeExecutionPath.has('workflow-2')).toBe(false)

    // Step 2: Router 2 selects function-2 (NOT workflow-2)
    mockContext.blockStates.set('router-2', {
      output: {
        selectedPath: {
          blockId: 'function-2',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 2',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-2')

    // Update paths after router-2 execution
    pathTracker.updateExecutionPaths(['router-2'], mockContext)

    // Verify router-2 decision
    expect(mockContext.decisions.router.get('router-2')).toBe('function-2')

    // After router-2 execution, function-2 should be active
    expect(mockContext.activeExecutionPath.has('function-2')).toBe(true)

    // CRITICAL: Workflow block should still NOT be activated (this was the bug!)
    expect(mockContext.activeExecutionPath.has('workflow-2')).toBe(false)

    // Step 3: Simulate what the executor's getNextExecutionLayer would do
    // This mimics the logic from executor/index.ts lines 991-994
    const blocksToExecute = workflow.blocks.filter(
      (block) =>
        !mockContext.executedBlocks.has(block.id) &&
        block.enabled !== false &&
        mockContext.activeExecutionPath.has(block.id)
    )

    const blockIds = blocksToExecute.map((b) => b.id)

    // Should only include function-2, NOT workflow-2
    expect(blockIds).toContain('function-2')
    expect(blockIds).not.toContain('workflow-2')

    // Verify that workflow block is not in active path
    expect(mockContext.activeExecutionPath.has('workflow-2')).toBe(false)

    // Verify that isInActivePath also returns false for workflow block
    const isWorkflowActive = pathTracker.isInActivePath('workflow-2', mockContext)
    expect(isWorkflowActive).toBe(false)
  })

  it('should allow workflow blocks to execute when selected by router', () => {
    // Test the positive case - workflow block should execute when actually selected

    // Step 1: Router 1 selects router-2
    mockContext.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'router-2',
          blockType: BlockType.ROUTER,
          blockTitle: 'Router 2',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-1')
    pathTracker.updateExecutionPaths(['router-1'], mockContext)

    // Step 2: Router 2 selects workflow-2 (NOT function-2)
    mockContext.blockStates.set('router-2', {
      output: {
        selectedPath: {
          blockId: 'workflow-2',
          blockType: BlockType.WORKFLOW,
          blockTitle: 'Workflow 2',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-2')
    pathTracker.updateExecutionPaths(['router-2'], mockContext)

    // Verify router-2 decision
    expect(mockContext.decisions.router.get('router-2')).toBe('workflow-2')

    // After router-2 execution, workflow-2 should be active
    expect(mockContext.activeExecutionPath.has('workflow-2')).toBe(true)

    // Function-2 should NOT be activated
    expect(mockContext.activeExecutionPath.has('function-2')).toBe(false)

    // Step 3: Verify workflow block would be included in next execution layer
    const blocksToExecute = workflow.blocks.filter(
      (block) =>
        !mockContext.executedBlocks.has(block.id) &&
        block.enabled !== false &&
        mockContext.activeExecutionPath.has(block.id)
    )

    const blockIds = blocksToExecute.map((b) => b.id)

    // Should include workflow-2, NOT function-2
    expect(blockIds).toContain('workflow-2')
    expect(blockIds).not.toContain('function-2')
  })

  it('should handle multiple sequential routers with workflow blocks correctly', () => {
    // This test ensures the fix works with the exact scenario from the bug report:
    // "The issue only seems to happen when there are multiple routing/conditional blocks"

    // Simulate the exact execution order from the CSV:
    // Router 1 → Function 1, Router 2 → Function 2, but Workflow 2 executed anyway

    // Step 1: Router 1 selects function-1 (not router-2)
    mockContext.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'function-1',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 1',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('router-1')
    pathTracker.updateExecutionPaths(['router-1'], mockContext)

    // After router-1, only function-1 should be active
    expect(mockContext.activeExecutionPath.has('function-1')).toBe(true)
    expect(mockContext.activeExecutionPath.has('router-2')).toBe(false)
    expect(mockContext.activeExecutionPath.has('workflow-2')).toBe(false)

    // Step 2: Execute function-1
    mockContext.blockStates.set('function-1', {
      output: { result: 'hi', stdout: '' },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('function-1')

    // Step 3: Check what blocks would be available for next execution
    const blocksToExecute = workflow.blocks.filter(
      (block) =>
        !mockContext.executedBlocks.has(block.id) &&
        block.enabled !== false &&
        mockContext.activeExecutionPath.has(block.id)
    )

    const blockIds = blocksToExecute.map((b) => b.id)

    // CRITICAL: Neither router-2 nor workflow-2 should be eligible for execution
    // because they were not selected by router-1
    expect(blockIds).not.toContain('router-2')
    expect(blockIds).not.toContain('workflow-2')
    expect(blockIds).not.toContain('function-2')

    // Verify none of the unselected blocks are in active path
    expect(mockContext.activeExecutionPath.has('router-2')).toBe(false)
    expect(mockContext.activeExecutionPath.has('workflow-2')).toBe(false)
    expect(mockContext.activeExecutionPath.has('function-2')).toBe(false)
  })
})
