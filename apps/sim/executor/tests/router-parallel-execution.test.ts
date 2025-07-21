import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { PathTracker } from '@/executor/path/path'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Router and Condition Block Path Selection in Complex Workflows', () => {
  let workflow: SerializedWorkflow
  let pathTracker: PathTracker
  let mockContext: ExecutionContext

  beforeEach(() => {
    workflow = {
      version: '2.0',
      blocks: [
        {
          id: 'bd9f4f7d-8aed-4860-a3be-8bebd1931b19',
          position: { x: 0, y: 0 },
          metadata: { id: BlockType.STARTER, name: 'Start' },
          config: { tool: BlockType.STARTER, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'f29a40b7-125a-45a7-a670-af14a1498f94',
          position: { x: 100, y: 0 },
          metadata: { id: BlockType.ROUTER, name: 'Router 1' },
          config: { tool: BlockType.ROUTER, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
          position: { x: 200, y: -50 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'a62902db-fd8d-4851-aa88-acd5e7667497',
          position: { x: 200, y: 50 },
          metadata: { id: BlockType.PARALLEL, name: 'Parallel 1' },
          config: { tool: BlockType.PARALLEL, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: '0494cf56-2520-4e29-98ad-313ea55cf142',
          position: { x: 300, y: -50 },
          metadata: { id: BlockType.CONDITION, name: 'Condition 1' },
          config: { tool: BlockType.CONDITION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: '033ea142-3002-4a68-9e12-092b10b8c9c8',
          position: { x: 400, y: -100 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 2' },
          config: { tool: BlockType.FUNCTION, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: '037140a8-fda3-44e2-896c-6adea53ea30f',
          position: { x: 400, y: 0 },
          metadata: { id: BlockType.PARALLEL, name: 'Parallel 2' },
          config: { tool: BlockType.PARALLEL, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'a91e3a02-b884-4823-8197-30ae498ac94c',
          position: { x: 300, y: 100 },
          metadata: { id: BlockType.AGENT, name: 'Agent 1' },
          config: { tool: BlockType.AGENT, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: '97974a42-cdf4-4810-9caa-b5e339f42ab0',
          position: { x: 500, y: 0 },
          metadata: { id: BlockType.AGENT, name: 'Agent 2' },
          config: { tool: BlockType.AGENT, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        // Start → Router 1
        {
          source: 'bd9f4f7d-8aed-4860-a3be-8bebd1931b19',
          target: 'f29a40b7-125a-45a7-a670-af14a1498f94',
        },
        // Router 1 → Function 1
        {
          source: 'f29a40b7-125a-45a7-a670-af14a1498f94',
          target: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
        },
        // Router 1 → Parallel 1
        {
          source: 'f29a40b7-125a-45a7-a670-af14a1498f94',
          target: 'a62902db-fd8d-4851-aa88-acd5e7667497',
        },
        // Function 1 → Condition 1
        {
          source: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
          target: '0494cf56-2520-4e29-98ad-313ea55cf142',
        },
        // Condition 1 → Function 2 (if path)
        {
          source: '0494cf56-2520-4e29-98ad-313ea55cf142',
          target: '033ea142-3002-4a68-9e12-092b10b8c9c8',
          sourceHandle: 'condition-0494cf56-2520-4e29-98ad-313ea55cf142-if',
        },
        // Condition 1 → Parallel 2 (else path)
        {
          source: '0494cf56-2520-4e29-98ad-313ea55cf142',
          target: '037140a8-fda3-44e2-896c-6adea53ea30f',
          sourceHandle: 'condition-0494cf56-2520-4e29-98ad-313ea55cf142-else',
        },
        // Parallel 1 → Agent 1
        {
          source: 'a62902db-fd8d-4851-aa88-acd5e7667497',
          target: 'a91e3a02-b884-4823-8197-30ae498ac94c',
          sourceHandle: 'parallel-start-source',
        },
        // Parallel 2 → Agent 2
        {
          source: '037140a8-fda3-44e2-896c-6adea53ea30f',
          target: '97974a42-cdf4-4810-9caa-b5e339f42ab0',
          sourceHandle: 'parallel-start-source',
        },
      ],
      loops: {},
      parallels: {
        'a62902db-fd8d-4851-aa88-acd5e7667497': {
          id: 'a62902db-fd8d-4851-aa88-acd5e7667497',
          nodes: ['a91e3a02-b884-4823-8197-30ae498ac94c'],
          distribution: ['item1', 'item2'],
        },
        '037140a8-fda3-44e2-896c-6adea53ea30f': {
          id: '037140a8-fda3-44e2-896c-6adea53ea30f',
          nodes: ['97974a42-cdf4-4810-9caa-b5e339f42ab0'],
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

    // Initialize execution state
    mockContext.executedBlocks.add('bd9f4f7d-8aed-4860-a3be-8bebd1931b19') // Start
    mockContext.activeExecutionPath.add('bd9f4f7d-8aed-4860-a3be-8bebd1931b19') // Start
    mockContext.activeExecutionPath.add('f29a40b7-125a-45a7-a670-af14a1498f94') // Router 1
  })

  it('should reproduce the exact router and condition block path selection scenario', () => {
    // Step 1: Router 1 executes and selects Function 1 (not Parallel 1)
    mockContext.blockStates.set('f29a40b7-125a-45a7-a670-af14a1498f94', {
      output: {
        selectedPath: {
          blockId: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 1',
        },
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('f29a40b7-125a-45a7-a670-af14a1498f94')

    pathTracker.updateExecutionPaths(['f29a40b7-125a-45a7-a670-af14a1498f94'], mockContext)

    // Verify router selected Function 1
    expect(mockContext.decisions.router.get('f29a40b7-125a-45a7-a670-af14a1498f94')).toBe(
      'd09b0a90-2c59-4a2c-af15-c30321e36d9b'
    )
    expect(mockContext.activeExecutionPath.has('d09b0a90-2c59-4a2c-af15-c30321e36d9b')).toBe(true) // Function 1

    // Parallel 1 should NOT be in active path (not selected by router)
    expect(mockContext.activeExecutionPath.has('a62902db-fd8d-4851-aa88-acd5e7667497')).toBe(false) // Parallel 1
    expect(mockContext.activeExecutionPath.has('a91e3a02-b884-4823-8197-30ae498ac94c')).toBe(false) // Agent 1

    // Step 2: Function 1 executes and returns "one"
    mockContext.blockStates.set('d09b0a90-2c59-4a2c-af15-c30321e36d9b', {
      output: {
        result: 'one',
        stdout: '',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('d09b0a90-2c59-4a2c-af15-c30321e36d9b')

    pathTracker.updateExecutionPaths(['d09b0a90-2c59-4a2c-af15-c30321e36d9b'], mockContext)

    // Function 1 should activate Condition 1
    expect(mockContext.activeExecutionPath.has('0494cf56-2520-4e29-98ad-313ea55cf142')).toBe(true) // Condition 1

    // Parallel 2 should NOT be in active path yet
    expect(mockContext.activeExecutionPath.has('037140a8-fda3-44e2-896c-6adea53ea30f')).toBe(false) // Parallel 2
    expect(mockContext.activeExecutionPath.has('97974a42-cdf4-4810-9caa-b5e339f42ab0')).toBe(false) // Agent 2

    // Step 3: Condition 1 executes and selects Function 2 (if path, not else/parallel path)
    mockContext.blockStates.set('0494cf56-2520-4e29-98ad-313ea55cf142', {
      output: {
        result: 'one',
        stdout: '',
        conditionResult: true,
        selectedPath: {
          blockId: '033ea142-3002-4a68-9e12-092b10b8c9c8',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 2',
        },
        selectedConditionId: '0494cf56-2520-4e29-98ad-313ea55cf142-if',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('0494cf56-2520-4e29-98ad-313ea55cf142')

    pathTracker.updateExecutionPaths(['0494cf56-2520-4e29-98ad-313ea55cf142'], mockContext)

    // Verify condition selected the if path (Function 2)
    expect(mockContext.decisions.condition.get('0494cf56-2520-4e29-98ad-313ea55cf142')).toBe(
      '0494cf56-2520-4e29-98ad-313ea55cf142-if'
    )
    expect(mockContext.activeExecutionPath.has('033ea142-3002-4a68-9e12-092b10b8c9c8')).toBe(true) // Function 2

    // CRITICAL: Parallel 2 should NOT be in active path (condition selected if, not else)
    expect(mockContext.activeExecutionPath.has('037140a8-fda3-44e2-896c-6adea53ea30f')).toBe(false) // Parallel 2
    expect(mockContext.activeExecutionPath.has('97974a42-cdf4-4810-9caa-b5e339f42ab0')).toBe(false) // Agent 2

    // Step 4: Function 2 executes (this should be the end of the workflow)
    mockContext.blockStates.set('033ea142-3002-4a68-9e12-092b10b8c9c8', {
      output: {
        result: 'two',
        stdout: '',
      },
      executed: true,
      executionTime: 0,
    })
    mockContext.executedBlocks.add('033ea142-3002-4a68-9e12-092b10b8c9c8')

    pathTracker.updateExecutionPaths(['033ea142-3002-4a68-9e12-092b10b8c9c8'], mockContext)

    // Final verification: Parallel 2 and Agent 2 should NEVER be in active path
    expect(mockContext.activeExecutionPath.has('037140a8-fda3-44e2-896c-6adea53ea30f')).toBe(false) // Parallel 2
    expect(mockContext.activeExecutionPath.has('97974a42-cdf4-4810-9caa-b5e339f42ab0')).toBe(false) // Agent 2

    // Simulate what executor's getNextExecutionLayer would return
    const blocksToExecute = workflow.blocks.filter(
      (block) =>
        mockContext.activeExecutionPath.has(block.id) && !mockContext.executedBlocks.has(block.id)
    )
    const blockIds = blocksToExecute.map((b) => b.id)

    // Should be empty (no more blocks to execute)
    expect(blockIds).toHaveLength(0)

    // Should NOT include Parallel 2 or Agent 2
    expect(blockIds).not.toContain('037140a8-fda3-44e2-896c-6adea53ea30f') // Parallel 2
    expect(blockIds).not.toContain('97974a42-cdf4-4810-9caa-b5e339f42ab0') // Agent 2
  })

  it('should test the isInActivePath method for Parallel 2', () => {
    // Set up the same execution state as above
    mockContext.executedBlocks.add('f29a40b7-125a-45a7-a670-af14a1498f94') // Router 1
    mockContext.executedBlocks.add('d09b0a90-2c59-4a2c-af15-c30321e36d9b') // Function 1
    mockContext.executedBlocks.add('0494cf56-2520-4e29-98ad-313ea55cf142') // Condition 1

    // Set router decision
    mockContext.decisions.router.set(
      'f29a40b7-125a-45a7-a670-af14a1498f94',
      'd09b0a90-2c59-4a2c-af15-c30321e36d9b'
    )

    // Set condition decision to if path (not else path)
    mockContext.decisions.condition.set(
      '0494cf56-2520-4e29-98ad-313ea55cf142',
      '0494cf56-2520-4e29-98ad-313ea55cf142-if'
    )

    // Test isInActivePath for Parallel 2
    const isParallel2Active = pathTracker.isInActivePath(
      '037140a8-fda3-44e2-896c-6adea53ea30f',
      mockContext
    )

    // Should be false because condition selected if path, not else path
    expect(isParallel2Active).toBe(false)
  })
})
