import { beforeEach, describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/consts'
import { Executor } from '@/executor/index'
import type { SerializedWorkflow } from '@/serializer/types'

describe('Multi-Input Routing Scenarios', () => {
  let workflow: SerializedWorkflow
  let executor: Executor

  beforeEach(() => {
    workflow = {
      version: '2.0',
      blocks: [
        {
          id: 'start',
          position: { x: 0, y: 0 },
          metadata: { id: BlockType.STARTER, name: 'Start' },
          config: { tool: BlockType.STARTER, params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'router-1',
          position: { x: 150, y: 0 },
          metadata: { id: BlockType.ROUTER, name: 'Router 1' },
          config: {
            tool: BlockType.ROUTER,
            params: {
              prompt: 'if the input is x, go to function 1.\notherwise, go to function 2.\ny',
              model: 'gpt-4o',
            },
          },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-1',
          position: { x: 300, y: -100 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 1' },
          config: {
            tool: BlockType.FUNCTION,
            params: { code: "return 'hi'" },
          },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-2',
          position: { x: 300, y: 100 },
          metadata: { id: BlockType.FUNCTION, name: 'Function 2' },
          config: {
            tool: BlockType.FUNCTION,
            params: { code: "return 'bye'" },
          },
          inputs: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'agent-1',
          position: { x: 500, y: 0 },
          metadata: { id: BlockType.AGENT, name: 'Agent 1' },
          config: {
            tool: BlockType.AGENT,
            params: {
              systemPrompt: 'return the following in urdu roman english',
              userPrompt: '<function1.result>\n<function2.result>',
              model: 'gpt-4o',
            },
          },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [
        { source: 'start', target: 'router-1' },
        { source: 'router-1', target: 'function-1' },
        { source: 'router-1', target: 'function-2' },
        { source: 'function-1', target: 'agent-1' }, // Agent depends on function-1
        { source: 'function-2', target: 'agent-1' }, // Agent depends on function-2
      ],
      loops: {},
      parallels: {},
    }

    executor = new Executor(workflow, {}, {})
  })

  it('should handle multi-input target when router selects function-1', async () => {
    // Test scenario: Router selects function-1, agent should still execute with function-1's output

    const context = (executor as any).createExecutionContext('test-workflow', new Date())

    // Step 1: Execute start block
    context.executedBlocks.add('start')
    context.activeExecutionPath.add('start')
    context.activeExecutionPath.add('router-1')

    // Step 2: Router selects function-1 (not function-2)
    context.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'function-1',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 1',
        },
      },
      executed: true,
      executionTime: 876,
    })
    context.executedBlocks.add('router-1')
    context.decisions.router.set('router-1', 'function-1')

    // Update execution paths after router-1
    const pathTracker = (executor as any).pathTracker
    pathTracker.updateExecutionPaths(['router-1'], context)

    // Verify only function-1 is active
    expect(context.activeExecutionPath.has('function-1')).toBe(true)
    expect(context.activeExecutionPath.has('function-2')).toBe(false)

    // Step 3: Execute function-1
    context.blockStates.set('function-1', {
      output: { result: 'hi', stdout: '' },
      executed: true,
      executionTime: 66,
    })
    context.executedBlocks.add('function-1')

    // Update paths after function-1
    pathTracker.updateExecutionPaths(['function-1'], context)

    // Step 4: Check agent-1 dependencies
    const agent1Connections = workflow.connections.filter((conn) => conn.target === 'agent-1')

    // Check dependencies for agent-1
    const agent1DependenciesMet = (executor as any).checkDependencies(
      agent1Connections,
      context.executedBlocks,
      context
    )

    // Step 5: Get next execution layer
    const nextLayer = (executor as any).getNextExecutionLayer(context)

    // CRITICAL TEST: Agent should be able to execute even though it has multiple inputs
    // The key is that the dependency logic should handle this correctly:
    // - function-1 executed and is selected → dependency met
    // - function-2 not executed and not selected → dependency considered met (inactive source)
    expect(agent1DependenciesMet).toBe(true)
    expect(nextLayer).toContain('agent-1')
  })

  it('should handle multi-input target when router selects function-2', async () => {
    // Test scenario: Router selects function-2, agent should still execute with function-2's output

    const context = (executor as any).createExecutionContext('test-workflow', new Date())

    // Step 1: Execute start and router-1 selecting function-2
    context.executedBlocks.add('start')
    context.activeExecutionPath.add('start')
    context.activeExecutionPath.add('router-1')

    context.blockStates.set('router-1', {
      output: {
        selectedPath: {
          blockId: 'function-2',
          blockType: BlockType.FUNCTION,
          blockTitle: 'Function 2',
        },
      },
      executed: true,
      executionTime: 876,
    })
    context.executedBlocks.add('router-1')
    context.decisions.router.set('router-1', 'function-2')

    const pathTracker = (executor as any).pathTracker
    pathTracker.updateExecutionPaths(['router-1'], context)

    // Verify only function-2 is active
    expect(context.activeExecutionPath.has('function-1')).toBe(false)
    expect(context.activeExecutionPath.has('function-2')).toBe(true)

    // Step 2: Execute function-2
    context.blockStates.set('function-2', {
      output: { result: 'bye', stdout: '' },
      executed: true,
      executionTime: 66,
    })
    context.executedBlocks.add('function-2')

    pathTracker.updateExecutionPaths(['function-2'], context)

    // Step 3: Check agent-1 dependencies
    const agent1Connections = workflow.connections.filter((conn) => conn.target === 'agent-1')
    const agent1DependenciesMet = (executor as any).checkDependencies(
      agent1Connections,
      context.executedBlocks,
      context
    )

    // Step 4: Get next execution layer
    const nextLayer = (executor as any).getNextExecutionLayer(context)

    // CRITICAL TEST: Agent should execute with function-2's output
    expect(agent1DependenciesMet).toBe(true)
    expect(nextLayer).toContain('agent-1')
  })

  it('should verify the dependency logic for inactive sources', async () => {
    // This test specifically validates the multi-input dependency logic

    const context = (executor as any).createExecutionContext('test-workflow', new Date())

    // Setup: Router executed and selected function-1, function-1 executed
    context.executedBlocks.add('start')
    context.executedBlocks.add('router-1')
    context.executedBlocks.add('function-1')
    context.decisions.router.set('router-1', 'function-1')
    context.activeExecutionPath.add('start')
    context.activeExecutionPath.add('router-1')
    context.activeExecutionPath.add('function-1')
    context.activeExecutionPath.add('agent-1') // Agent should be active due to function-1

    // Test individual dependency checks
    const checkDependencies = (executor as any).checkDependencies.bind(executor)

    // Connection from function-1 (executed, selected) → should be met
    const function1Connection = [{ source: 'function-1', target: 'agent-1' }]
    const function1DepMet = checkDependencies(function1Connection, context.executedBlocks, context)

    // Connection from function-2 (not executed, not selected) → should be met because of inactive source logic
    const function2Connection = [{ source: 'function-2', target: 'agent-1' }]
    const function2DepMet = checkDependencies(function2Connection, context.executedBlocks, context)

    // Both connections together (the actual agent scenario)
    const bothConnections = [
      { source: 'function-1', target: 'agent-1' },
      { source: 'function-2', target: 'agent-1' },
    ]
    const bothDepMet = checkDependencies(bothConnections, context.executedBlocks, context)

    // CRITICAL ASSERTIONS:
    expect(function1DepMet).toBe(true) // Executed and active
    expect(function2DepMet).toBe(true) // Not in active path, so considered met (line 1151)
    expect(bothDepMet).toBe(true) // All dependencies should be met
  })
})
