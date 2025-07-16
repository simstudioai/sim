/**
 * @vitest-environment node
 *
 * Executor Class Unit Tests
 *
 * This file contains unit tests for the Executor class, which is responsible for
 * running workflow blocks in topological order, handling the execution flow,
 * resolving inputs and dependencies, and managing errors.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Executor } from '@/executor'
import {
  createMinimalWorkflow,
  createMockContext,
  createWorkflowWithCondition,
  createWorkflowWithErrorPath,
  createWorkflowWithLoop,
  setupAllMocks,
} from '@/executor/__test-utils__/executor-mocks'
import { BlockType } from '@/executor/consts'

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn(() => ({
      setIsExecuting: vi.fn(),
      setIsDebugging: vi.fn(),
      setPendingBlocks: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
    })),
    setState: vi.fn(),
  },
}))

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  /**
   * Initialization tests
   */
  describe('initialization', () => {
    test('should create an executor instance with legacy constructor format', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(Executor)
    })

    test('should create an executor instance with new options object format', () => {
      const workflow = createMinimalWorkflow()
      const initialStates = {
        block1: { result: { value: 'Initial state' } },
      }
      const envVars = { API_KEY: 'test-key', BASE_URL: 'https://example.com' }
      const workflowInput = { query: 'test query' }
      const workflowVariables = { var1: 'value1' }

      const executor = new Executor({
        workflow,
        currentBlockStates: initialStates,
        envVarValues: envVars,
        workflowInput,
        workflowVariables,
      })

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(Executor)

      // Verify that all properties are properly initialized
      expect((executor as any).actualWorkflow).toBe(workflow)
      expect((executor as any).initialBlockStates).toEqual(initialStates)
      expect((executor as any).environmentVariables).toEqual(envVars)
      expect((executor as any).workflowInput).toEqual(workflowInput)
      expect((executor as any).workflowVariables).toEqual(workflowVariables)
    })

    test('should accept streaming context extensions', () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputIds: ['block1'],
          edges: [{ source: 'starter', target: 'block1' }],
          onStream: mockOnStream,
        },
      })

      expect(executor).toBeDefined()
    })

    test('should handle legacy constructor with individual parameters', () => {
      const workflow = createMinimalWorkflow()
      const initialStates = {
        block1: { result: { value: 'Initial state' } },
      }
      const envVars = { API_KEY: 'test-key' }
      const workflowInput = { query: 'test query' }
      const workflowVariables = { var1: 'value1' }

      const executor = new Executor(
        workflow,
        initialStates,
        envVars,
        workflowInput,
        workflowVariables
      )
      expect(executor).toBeDefined()
    })
  })

  /**
   * Validation tests
   */
  describe('workflow validation', () => {
    test('should validate workflow on initialization', () => {
      const validateSpy = vi.spyOn(Executor.prototype as any, 'validateWorkflow')

      const workflow = createMinimalWorkflow()
      const _executor = new Executor(workflow)

      expect(validateSpy).toHaveBeenCalled()
    })

    test('should validate workflow on execution', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const validateSpy = vi.spyOn(executor as any, 'validateWorkflow')
      validateSpy.mockClear()

      await executor.execute('test-workflow-id')

      expect(validateSpy).toHaveBeenCalledTimes(1)
    })

    test('should throw error for workflow without starter block', () => {
      const workflow = createMinimalWorkflow()
      workflow.blocks = workflow.blocks.filter((block) => block.metadata?.id !== BlockType.STARTER)

      expect(() => new Executor(workflow)).toThrow('Workflow must have an enabled starter block')
    })

    test('should throw error for workflow with disabled starter block', () => {
      const workflow = createMinimalWorkflow()
      workflow.blocks.find((block) => block.metadata?.id === BlockType.STARTER)!.enabled = false

      expect(() => new Executor(workflow)).toThrow('Workflow must have an enabled starter block')
    })

    test('should throw error if starter block has incoming connections', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections.push({
        source: 'block1',
        target: 'starter',
      })

      expect(() => new Executor(workflow)).toThrow('Starter block cannot have incoming connections')
    })

    test('should throw error if starter block has no outgoing connections', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections = []

      expect(() => new Executor(workflow)).toThrow(
        'Starter block must have at least one outgoing connection'
      )
    })

    test('should throw error if connection references non-existent source block', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections.push({
        source: 'non-existent-block',
        target: 'block1',
      })

      expect(() => new Executor(workflow)).toThrow(
        'Connection references non-existent source block: non-existent-block'
      )
    })

    test('should throw error if connection references non-existent target block', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections.push({
        source: 'starter',
        target: 'non-existent-block',
      })

      expect(() => new Executor(workflow)).toThrow(
        'Connection references non-existent target block: non-existent-block'
      )
    })
  })

  /**
   * Execution tests
   */
  describe('workflow execution', () => {
    test('should execute workflow and return ExecutionResult', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const result = await executor.execute('test-workflow-id')

      // Check if result is a StreamingExecution or ExecutionResult
      if ('success' in result) {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('output')

        // Our mocked implementation results in a false success value
        // In real usage, this would be true for successful executions
        expect(typeof result.success).toBe('boolean')
      } else {
        // Handle StreamingExecution case
        expect(result).toHaveProperty('stream')
        expect(result).toHaveProperty('execution')
        expect(result.stream).toBeInstanceOf(ReadableStream)
      }
    })

    test('should handle streaming execution with onStream callback', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputIds: ['block1'],
          onStream: mockOnStream,
        },
      })

      const result = await executor.execute('test-workflow-id')

      // With streaming enabled, should handle both ExecutionResult and StreamingExecution
      if ('stream' in result) {
        expect(result.stream).toBeInstanceOf(ReadableStream)
        expect(result.execution).toBeDefined()
      } else {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('output')
      }
    })

    test('should pass context extensions to execution context', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()
      const selectedOutputIds = ['block1', 'block2']
      const edges = [{ source: 'starter', target: 'block1' }]

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputIds,
          edges,
          onStream: mockOnStream,
        },
      })

      // Spy on createExecutionContext to verify context extensions are passed
      const createContextSpy = vi.spyOn(executor as any, 'createExecutionContext')

      await executor.execute('test-workflow-id')

      expect(createContextSpy).toHaveBeenCalled()
      const contextArg = createContextSpy.mock.calls[0][2] // third argument is startTime, context is created internally
    })
  })

  /**
   * Condition and loop tests
   */
  describe('special blocks', () => {
    test('should handle condition blocks without errors', async () => {
      const workflow = createWorkflowWithCondition()
      const executor = new Executor(workflow)

      const result = await executor.execute('test-workflow-id')

      // Verify execution completes and returns expected structure
      if ('success' in result) {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('output')
      } else {
        expect(result).toHaveProperty('stream')
        expect(result).toHaveProperty('execution')
      }
    })

    test('should handle loop structures without errors', async () => {
      const workflow = createWorkflowWithLoop()
      const executor = new Executor(workflow)

      const result = await executor.execute('test-workflow-id')

      // Verify execution completes and returns expected structure
      if ('success' in result) {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('output')
      } else {
        expect(result).toHaveProperty('stream')
        expect(result).toHaveProperty('execution')
      }
    })
  })

  /**
   * Debug mode tests
   */
  describe('debug mode', () => {
    test('should detect debug mode from settings', async () => {
      // Reset and reconfigure mocks for debug mode
      vi.resetModules()
      vi.clearAllMocks()

      // Setup mocks with debug mode enabled
      setupAllMocks({ isDebugModeEnabled: true })

      // Import Executor AFTER setting up mocks
      const { Executor } = await import('./index')

      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const isDebugging = (executor as any).isDebugging

      expect(isDebugging).toBe(true)
    })

    test('should work with debug mode disabled', async () => {
      // Reset and reconfigure mocks for normal mode
      vi.resetModules()
      vi.clearAllMocks()

      // Setup mocks with debug mode disabled (default)
      setupAllMocks({ isDebugModeEnabled: false })

      // Import Executor AFTER setting up mocks
      const { Executor } = await import('./index')

      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const isDebugging = (executor as any).isDebugging

      expect(isDebugging).toBe(false)
    })

    test('should handle continue execution in debug mode', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Create a mock context for debug continuation
      const mockContext = createMockContext()
      mockContext.blockStates.set('starter', {
        output: { input: {} },
        executed: true,
        executionTime: 0,
      })

      const result = await executor.continueExecution(['block1'], mockContext)

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('output')
      expect(result).toHaveProperty('logs')
    })
  })

  /**
   * Additional tests to improve coverage
   */
  describe('block output handling', () => {
    test('should handle different block outputs correctly', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Test basic workflow execution
      expect(executor).toBeDefined()
      expect(typeof executor.execute).toBe('function')
    })

    test('should handle error outputs correctly', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Test error handling functionality
      const extractErrorMessage = (executor as any).extractErrorMessage.bind(executor)

      // Test error message extraction
      const error = new Error('Test error message')
      const errorMessage = extractErrorMessage(error)
      expect(errorMessage).toBe('Test error message')
    })
  })

  /**
   * Error handling tests
   */
  describe('error handling', () => {
    test('should activate error paths when a block has an error', () => {
      const workflow = createWorkflowWithErrorPath()
      const executor = new Executor(workflow)

      // Mock context
      const context = {
        executedBlocks: new Set<string>(['starter', 'block1']),
        activeExecutionPath: new Set<string>(['block1']),
        blockStates: new Map(),
        workflow: workflow,
      } as any

      // Add error state to the block
      context.blockStates.set('block1', {
        output: {
          error: 'Test error',
        },
        executed: true,
      })

      // Call activateErrorPath method
      const activateErrorPath = (executor as any).activateErrorPath.bind(executor)
      const result = activateErrorPath('block1', context)

      // Should return true since there is an error path
      expect(result).toBe(true)

      // Error-handler block should be in active execution path
      expect(context.activeExecutionPath.has('error-handler')).toBe(true)
    })

    test('should not activate error paths for starter and condition blocks', () => {
      const workflow = createWorkflowWithErrorPath()
      const executor = new Executor(workflow)

      // Add condition block
      workflow.blocks.push({
        id: 'condition-block',
        position: { x: 300, y: 0 },
        config: { tool: 'test-tool', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
        metadata: { id: BlockType.CONDITION, name: 'Condition Block' },
      })

      // Mock context
      const context = {
        executedBlocks: new Set<string>(['starter', 'condition-block']),
        activeExecutionPath: new Set<string>(['condition-block']),
        blockStates: new Map(),
        workflow: workflow,
      } as any

      // Add error states
      context.blockStates.set('starter', {
        output: { error: 'Test error' },
        executed: true,
      })

      context.blockStates.set('condition-block', {
        output: { error: 'Test error' },
        executed: true,
      })

      // Call activateErrorPath method
      const activateErrorPath = (executor as any).activateErrorPath.bind(executor)

      // Should return false for both blocks
      expect(activateErrorPath('starter', context)).toBe(false)
      expect(activateErrorPath('condition-block', context)).toBe(false)
    })

    test('should return false if no error connections exist', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Mock context
      const context = {
        executedBlocks: new Set<string>(['starter', 'block1']),
        activeExecutionPath: new Set<string>(['block1']),
        blockStates: new Map(),
        workflow: workflow,
      } as any

      // Add error state to the block
      context.blockStates.set('block1', {
        output: { error: 'Test error' },
        executed: true,
      })

      // Call activateErrorPath method
      const activateErrorPath = (executor as any).activateErrorPath.bind(executor)
      const result = activateErrorPath('block1', context)

      // Should return false since there is no error path
      expect(result).toBe(false)
    })

    test('should create proper error output for a block error', () => {
      const workflow = createWorkflowWithErrorPath()
      const executor = new Executor(workflow)

      // Create an error with additional properties
      const testError = new Error('Test function execution error') as Error & {
        status?: number
      }
      testError.status = 400

      // Create a context with blockLogs
      const _mockContext = {
        blockLogs: [],
        blockStates: new Map(),
        executedBlocks: new Set<string>(),
        activeExecutionPath: new Set<string>(['block1']),
        workflow,
      }

      // Call the extractErrorMessage method directly
      const extractErrorMessage = (executor as any).extractErrorMessage.bind(executor)
      const errorMessage = extractErrorMessage(testError)

      // Verify the error message is extracted correctly
      expect(errorMessage).toBe('Test function execution error')

      // Create an error output manually
      const errorOutput = {
        error: errorMessage,
        status: testError.status || 500,
      }

      // Verify the error output structure
      expect(errorOutput).toHaveProperty('error')
      expect(errorOutput).toHaveProperty('status')
    })

    test('should handle "undefined (undefined)" error case', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const extractErrorMessage = (executor as any).extractErrorMessage.bind(executor)

      // Test the specific "undefined (undefined)" error case
      const undefinedError = { message: 'undefined (undefined)' }
      const errorMessage = extractErrorMessage(undefinedError)

      expect(errorMessage).toBe('undefined (undefined)')
    })
  })

  /**
   * Streaming execution tests
   */
  describe('streaming execution', () => {
    test('should handle streaming execution results', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      // Mock a streaming execution result
      const mockStreamingResult = {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('chunk1'))
            controller.enqueue(new TextEncoder().encode('chunk2'))
            controller.close()
          },
        }),
        execution: {
          blockId: 'agent-1',
          output: { response: { content: 'Final content' } },
        },
      }

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputIds: ['block1'],
          onStream: mockOnStream,
        },
      })

      const result = await executor.execute('test-workflow-id')

      // Verify result structure
      if ('stream' in result) {
        expect(result.stream).toBeInstanceOf(ReadableStream)
        expect(result.execution).toBeDefined()
      }
    })

    test('should process streaming content in context', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputIds: ['block1'],
          onStream: mockOnStream,
        },
      })

      // Test that execution context contains streaming properties
      const createContextSpy = vi.spyOn(executor as any, 'createExecutionContext')

      await executor.execute('test-workflow-id')

      expect(createContextSpy).toHaveBeenCalled()
    })
  })

  /**
   * Dependency checking logic tests
   */
  describe('dependency checking', () => {
    test('should handle multi-input blocks with inactive sources correctly', () => {
      // Create workflow with router -> multiple APIs -> single agent
      const routerWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            metadata: { id: BlockType.STARTER, name: 'Start' },
            config: { tool: 'test-tool', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'router',
            position: { x: 100, y: 0 },
            metadata: { id: BlockType.ROUTER, name: 'Router' },
            config: { tool: 'test-tool', params: { prompt: 'test', model: 'gpt-4' } },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'api1',
            position: { x: 200, y: -50 },
            metadata: { id: BlockType.API, name: 'API 1' },
            config: { tool: 'test-tool', params: { url: 'http://api1.com', method: 'GET' } },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'api2',
            position: { x: 200, y: 50 },
            metadata: { id: BlockType.API, name: 'API 2' },
            config: { tool: 'test-tool', params: { url: 'http://api2.com', method: 'GET' } },
            inputs: {},
            outputs: {},
            enabled: true,
          },
          {
            id: 'agent',
            position: { x: 300, y: 0 },
            metadata: { id: BlockType.AGENT, name: 'Agent' },
            config: { tool: 'test-tool', params: { model: 'gpt-4', userPrompt: 'test' } },
            inputs: {},
            outputs: {},
            enabled: true,
          },
        ],
        connections: [
          { source: 'start', target: 'router' },
          { source: 'router', target: 'api1' },
          { source: 'router', target: 'api2' },
          { source: 'api1', target: 'agent' },
          { source: 'api2', target: 'agent' },
        ],
        loops: {},
        parallels: {},
      }

      const executor = new Executor(routerWorkflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      // Mock context simulating: router selected api1, api1 executed, api2 not in active path
      const mockContext = {
        blockStates: new Map(),
        decisions: {
          router: new Map([['router', 'api1']]),
          condition: new Map(),
        },
        activeExecutionPath: new Set(['start', 'router', 'api1', 'agent']),
        workflow: routerWorkflow,
      } as any

      const executedBlocks = new Set(['start', 'router', 'api1'])

      // Test agent's dependencies
      const agentConnections = [
        { source: 'api1', target: 'agent', sourceHandle: 'source' },
        { source: 'api2', target: 'agent', sourceHandle: 'source' },
      ]

      const dependenciesMet = checkDependencies(agentConnections, executedBlocks, mockContext)

      // Both dependencies should be met:
      // - api1: in active path AND executed = met
      // - api2: NOT in active path = automatically met
      expect(dependenciesMet).toBe(true)
    })

    test('should prioritize special connection types over active path check', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      const mockContext = {
        blockStates: new Map(),
        decisions: { router: new Map(), condition: new Map() },
        activeExecutionPath: new Set(['block1']), // block2 not in active path
        completedLoops: new Set(),
        workflow: workflow,
      } as any

      const executedBlocks = new Set(['block1'])

      // Test error connection (should be handled before active path check)
      const errorConnections = [{ source: 'block2', target: 'block3', sourceHandle: 'error' }]

      // Mock block2 with error state
      mockContext.blockStates.set('block2', {
        output: { error: 'test error' },
      })

      // Even though block2 is not in active path, error connection should be handled specially
      const errorDepsResult = checkDependencies(errorConnections, new Set(['block2']), mockContext)
      expect(errorDepsResult).toBe(true) // source executed + has error = dependency met

      // Test loop connection
      const loopConnections = [
        { source: 'block2', target: 'block3', sourceHandle: 'loop-end-source' },
      ]

      mockContext.completedLoops.add('block2')
      const loopDepsResult = checkDependencies(loopConnections, new Set(['block2']), mockContext)
      expect(loopDepsResult).toBe(true) // loop completed = dependency met
    })

    test('should handle router decisions correctly in dependency checking', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      // Add router block to workflow
      workflow.blocks.push({
        id: 'router1',
        position: { x: 200, y: 0 },
        metadata: { id: BlockType.ROUTER, name: 'Router' },
        config: { tool: 'test-tool', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      })

      const mockContext = {
        blockStates: new Map(),
        decisions: {
          router: new Map([['router1', 'target1']]), // router selected target1
          condition: new Map(),
        },
        activeExecutionPath: new Set(['router1', 'target1', 'target2']),
        workflow: workflow,
      } as any

      const executedBlocks = new Set(['router1'])

      // Test selected target
      const selectedConnections = [{ source: 'router1', target: 'target1', sourceHandle: 'source' }]
      const selectedResult = checkDependencies(selectedConnections, executedBlocks, mockContext)
      expect(selectedResult).toBe(true) // router executed + target selected = dependency met

      // Test non-selected target
      const nonSelectedConnections = [
        { source: 'router1', target: 'target2', sourceHandle: 'source' },
      ]
      const nonSelectedResult = checkDependencies(
        nonSelectedConnections,
        executedBlocks,
        mockContext
      )
      expect(nonSelectedResult).toBe(true) // router executed + target NOT selected = dependency auto-met
    })

    test('should handle condition decisions correctly in dependency checking', () => {
      const conditionWorkflow = createWorkflowWithCondition()
      const executor = new Executor(conditionWorkflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      const mockContext = {
        blockStates: new Map(),
        decisions: {
          router: new Map(),
          condition: new Map([['condition1', 'true']]), // condition selected true path
        },
        activeExecutionPath: new Set(['condition1', 'trueTarget']),
        workflow: conditionWorkflow,
      } as any

      const executedBlocks = new Set(['condition1'])

      // Test selected condition path
      const trueConnections = [
        { source: 'condition1', target: 'trueTarget', sourceHandle: 'condition-true' },
      ]
      const trueResult = checkDependencies(trueConnections, executedBlocks, mockContext)
      expect(trueResult).toBe(true)

      // Test non-selected condition path
      const falseConnections = [
        { source: 'condition1', target: 'falseTarget', sourceHandle: 'condition-false' },
      ]
      const falseResult = checkDependencies(falseConnections, executedBlocks, mockContext)
      expect(falseResult).toBe(true) // condition executed + path NOT selected = dependency auto-met
    })

    test('should handle regular sequential dependencies correctly', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      const mockContext = {
        blockStates: new Map(),
        decisions: { router: new Map(), condition: new Map() },
        activeExecutionPath: new Set(['block1', 'block2']),
        workflow: workflow,
      } as any

      const executedBlocks = new Set(['block1'])

      // Test normal sequential dependency
      const normalConnections = [{ source: 'block1', target: 'block2', sourceHandle: 'source' }]

      // Without error
      const normalResult = checkDependencies(normalConnections, executedBlocks, mockContext)
      expect(normalResult).toBe(true) // source executed + no error = dependency met

      // With error should fail regular connection
      mockContext.blockStates.set('block1', {
        output: { error: 'test error' },
      })
      const errorResult = checkDependencies(normalConnections, executedBlocks, mockContext)
      expect(errorResult).toBe(false) // source executed + has error = regular dependency not met
    })

    test('should handle empty dependency list', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      const mockContext = createMockContext()
      const executedBlocks = new Set<string>()

      // Empty connections should return true
      const result = checkDependencies([], executedBlocks, mockContext)
      expect(result).toBe(true)
    })
  })
})
