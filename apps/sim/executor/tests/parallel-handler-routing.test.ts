import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { ParallelBlockHandler } from '@/executor/handlers/parallel/parallel-handler'
import { PathTracker } from '@/executor/path/path'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Parallel Handler Integration with PathTracker', () => {
  let workflow: SerializedWorkflow
  let pathTracker: PathTracker
  let parallelHandler: ParallelBlockHandler
  let mockContext: ExecutionContext

  beforeEach(() => {
    // Create a simplified workflow with condition → parallel scenario
    workflow = {
      version: '2.0',
      blocks: [
        {
          id: 'condition-1',
          position: { x: 0, y: 0 },
          metadata: { id: BlockType.CONDITION, name: 'Condition 1' },
          config: { tool: BlockType.CONDITION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-2',
          position: { x: 100, y: -50 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 2' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'parallel-2',
          position: { x: 100, y: 50 },
          metadata: { id: BlockType.PARALLEL, name: 'Parallel 2' },
          config: { tool: BlockType.PARALLEL, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'agent-2',
          position: { x: 200, y: 50 },
          metadata: { id: BlockType.AGENT, name: 'Agent 2' },
          config: { tool: BlockType.AGENT, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        // Condition → Function 2 (if path)
        {
          source: 'condition-1',
          target: 'function-2',
          sourceHandle: 'condition-test-if',
        },
        // Condition → Parallel 2 (else path)
        {
          source: 'condition-1',
          target: 'parallel-2',
          sourceHandle: 'condition-test-else',
        },
        // Parallel 2 → Agent 2
        {
          source: 'parallel-2',
          target: 'agent-2',
          sourceHandle: 'parallel-start-source',
        },
      ],
      loops: {},
      parallels: {
        'parallel-2': {
          id: 'parallel-2',
          nodes: ['agent-2'],
          distribution: ['item1', 'item2'],
        },
      },
    }

    pathTracker = new PathTracker(workflow)
    parallelHandler = new ParallelBlockHandler(undefined, pathTracker)

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
  })

  it('should not allow parallel block to execute when not in active path', async () => {
    // Set up scenario where condition selected function-2 (if path), not parallel-2 (else path)
    mockContext.decisions.condition.set('condition-1', 'test-if')
    mockContext.executedBlocks.add('condition-1')
    mockContext.activeExecutionPath.add('condition-1')
    mockContext.activeExecutionPath.add('function-2') // Only function-2 should be active

    // Parallel-2 should NOT be in active path
    expect(mockContext.activeExecutionPath.has('parallel-2')).toBe(false)

    // Test PathTracker's isInActivePath method
    const isParallel2Active = pathTracker.isInActivePath('parallel-2', mockContext)
    expect(isParallel2Active).toBe(false)

    // Get the parallel block
    const parallelBlock = workflow.blocks.find((b) => b.id === 'parallel-2')!

    // Try to execute the parallel block
    const result = await parallelHandler.execute(parallelBlock, {}, mockContext)

    // The parallel block should execute (return started: true) but should NOT activate its children
    expect(result).toMatchObject({
      parallelId: 'parallel-2',
      started: true,
    })

    // CRITICAL: Agent 2 should NOT be activated because parallel-2 is not in active path
    expect(mockContext.activeExecutionPath.has('agent-2')).toBe(false)
  })

  it('should allow parallel block to execute and activate children when in active path', async () => {
    // Set up scenario where condition selected parallel-2 (else path)
    mockContext.decisions.condition.set('condition-1', 'test-else')
    mockContext.executedBlocks.add('condition-1')
    mockContext.activeExecutionPath.add('condition-1')
    mockContext.activeExecutionPath.add('parallel-2') // Parallel-2 should be active

    // Parallel-2 should be in active path
    expect(mockContext.activeExecutionPath.has('parallel-2')).toBe(true)

    // Test PathTracker's isInActivePath method
    const isParallel2Active = pathTracker.isInActivePath('parallel-2', mockContext)
    expect(isParallel2Active).toBe(true)

    // Get the parallel block
    const parallelBlock = workflow.blocks.find((b) => b.id === 'parallel-2')!

    // Try to execute the parallel block
    const result = await parallelHandler.execute(parallelBlock, {}, mockContext)

    // The parallel block should execute and activate its children
    expect(result).toMatchObject({
      parallelId: 'parallel-2',
      started: true,
    })

    // Agent 2 should be activated because parallel-2 is in active path
    expect(mockContext.activeExecutionPath.has('agent-2')).toBe(true)
  })

  it('should test the routing failure scenario with parallel block', async () => {
    // Step 1: Condition 1 selects Function 2 (if path)
    mockContext.blockStates.set('condition-1', {
      output: {
        result: 'one',
        stdout: '',
        conditionResult: true,
        selectedPath: {
          blockId: 'function-2',
          blockType: 'function',
          blockTitle: 'Function 2',
        },
        selectedConditionId: 'test-if',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('condition-1')
    mockContext.activeExecutionPath.add('condition-1')

    // Update paths after condition execution
    pathTracker.updateExecutionPaths(['condition-1'], mockContext)

    // Verify condition selected if path
    expect(mockContext.decisions.condition.get('condition-1')).toBe('test-if')
    expect(mockContext.activeExecutionPath.has('function-2')).toBe(true)
    expect(mockContext.activeExecutionPath.has('parallel-2')).toBe(false)

    // Step 2: Try to execute parallel-2 (should not activate children)
    const parallelBlock = workflow.blocks.find((b) => b.id === 'parallel-2')!
    const result = await parallelHandler.execute(parallelBlock, {}, mockContext)

    // Parallel should execute but not activate children
    expect(result).toMatchObject({
      parallelId: 'parallel-2',
      started: true,
    })

    // CRITICAL: Agent 2 should NOT be activated
    expect(mockContext.activeExecutionPath.has('agent-2')).toBe(false)
  })
})
