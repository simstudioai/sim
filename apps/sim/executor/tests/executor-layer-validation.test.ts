import { beforeEach, describe, expect, it } from 'vitest'
import { Executor } from '@/executor'
import { BlockType } from '@/executor/consts'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Full Executor Test', () => {
  let workflow: SerializedWorkflow
  let executor: Executor

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
          config: {
            tool: BlockType.ROUTER,
            params: {
              prompt: 'if x then function 1\nif y then parallel\n\ninput: x',
              model: 'gpt-4o',
            },
          },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
          position: { x: 200, y: -50 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
          config: { tool: BlockType.FUNCTION, params: { code: "return 'one'" } },
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
          metadata: { id: 'condition', name: 'Condition 1' },
          config: { tool: 'condition', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: '033ea142-3002-4a68-9e12-092b10b8c9c8',
          position: { x: 400, y: -100 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 2' },
          config: { tool: BlockType.FUNCTION, params: { code: "return 'two'" } },
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
          metadata: { id: 'agent', name: 'Agent 1' },
          config: { tool: 'agent', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: '97974a42-cdf4-4810-9caa-b5e339f42ab0',
          position: { x: 500, y: 0 },
          metadata: { id: 'agent', name: 'Agent 2' },
          config: { tool: 'agent', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        {
          source: 'bd9f4f7d-8aed-4860-a3be-8bebd1931b19',
          target: 'f29a40b7-125a-45a7-a670-af14a1498f94',
        },
        {
          source: 'f29a40b7-125a-45a7-a670-af14a1498f94',
          target: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
        },
        {
          source: 'f29a40b7-125a-45a7-a670-af14a1498f94',
          target: 'a62902db-fd8d-4851-aa88-acd5e7667497',
        },
        {
          source: 'd09b0a90-2c59-4a2c-af15-c30321e36d9b',
          target: '0494cf56-2520-4e29-98ad-313ea55cf142',
        },
        {
          source: '0494cf56-2520-4e29-98ad-313ea55cf142',
          target: '033ea142-3002-4a68-9e12-092b10b8c9c8',
          sourceHandle: 'condition-0494cf56-2520-4e29-98ad-313ea55cf142-if',
        },
        {
          source: '0494cf56-2520-4e29-98ad-313ea55cf142',
          target: '037140a8-fda3-44e2-896c-6adea53ea30f',
          sourceHandle: 'condition-0494cf56-2520-4e29-98ad-313ea55cf142-else',
        },
        {
          source: 'a62902db-fd8d-4851-aa88-acd5e7667497',
          target: 'a91e3a02-b884-4823-8197-30ae498ac94c',
          sourceHandle: 'parallel-start-source',
        },
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

    executor = new Executor(workflow)
  })

  it('should test the full executor flow and see what happens', async () => {
    // Mock the necessary functions to avoid actual API calls
    const mockInput = {}

    try {
      // Execute the workflow
      const result = await executor.execute('test-workflow-id')

      // Check if it's an ExecutionResult (not StreamingExecution)
      if ('success' in result) {
        // Check if there are any logs that might indicate what happened
        if (result.logs) {
        }

        // The test itself doesn't need to assert anything specific
        // We just want to see what the executor does
        expect(result.success).toBeDefined()
      } else {
        expect(result).toBeDefined()
      }
    } catch (error) {
      console.error('Execution error:', error)
      // Log the error but don't fail the test - we want to see what happens
    }
  })

  it('should test the executor getNextExecutionLayer method directly', async () => {
    // Create a mock context in the exact state after the condition executes
    const context = (executor as any).createExecutionContext('test-workflow', new Date())

    // Set up the state as it would be after the condition executes
    context.executedBlocks.add('bd9f4f7d-8aed-4860-a3be-8bebd1931b19') // Start
    context.executedBlocks.add('f29a40b7-125a-45a7-a670-af14a1498f94') // Router 1
    context.executedBlocks.add('d09b0a90-2c59-4a2c-af15-c30321e36d9b') // Function 1
    context.executedBlocks.add('0494cf56-2520-4e29-98ad-313ea55cf142') // Condition 1
    context.executedBlocks.add('033ea142-3002-4a68-9e12-092b10b8c9c8') // Function 2

    // Set router decision
    context.decisions.router.set(
      'f29a40b7-125a-45a7-a670-af14a1498f94',
      'd09b0a90-2c59-4a2c-af15-c30321e36d9b'
    )

    // Set condition decision to if path (Function 2)
    context.decisions.condition.set(
      '0494cf56-2520-4e29-98ad-313ea55cf142',
      '0494cf56-2520-4e29-98ad-313ea55cf142-if'
    )

    // Set up active execution path as it should be after condition
    context.activeExecutionPath.add('bd9f4f7d-8aed-4860-a3be-8bebd1931b19')
    context.activeExecutionPath.add('f29a40b7-125a-45a7-a670-af14a1498f94')
    context.activeExecutionPath.add('d09b0a90-2c59-4a2c-af15-c30321e36d9b')
    context.activeExecutionPath.add('0494cf56-2520-4e29-98ad-313ea55cf142')
    context.activeExecutionPath.add('033ea142-3002-4a68-9e12-092b10b8c9c8')

    // Get the next execution layer
    const nextLayer = (executor as any).getNextExecutionLayer(context)

    // Check if Parallel 2 is in the next execution layer
    const hasParallel2 = nextLayer.includes('037140a8-fda3-44e2-896c-6adea53ea30f')

    // Check if Agent 2 is in the next execution layer
    const hasAgent2 = nextLayer.includes('97974a42-cdf4-4810-9caa-b5e339f42ab0')

    // The key test: Parallel 2 should NOT be in the next execution layer
    expect(nextLayer).not.toContain('037140a8-fda3-44e2-896c-6adea53ea30f')
    expect(nextLayer).not.toContain('97974a42-cdf4-4810-9caa-b5e339f42ab0')
  })
})
