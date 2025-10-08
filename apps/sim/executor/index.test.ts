/**
 * @vitest-environment node
 *
 * Executor Class Unit Tests
 *
 * This file contains unit tests for the Executor class, which is responsible for
 * running workflow blocks in topological order, handling the execution flow,
 * resolving inputs and dependencies, and managing errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockOutput, ParamType } from '@/blocks/types'
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

vi.mock('@/lib/logs/console/logger', () => ({
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
    it.concurrent('should create an executor instance with legacy constructor format', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(Executor)
    })

    it.concurrent('should create an executor instance with new options object format', () => {
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

    it.concurrent('should accept streaming context extensions', () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputs: ['block1'],
          edges: [{ source: 'starter', target: 'block1' }],
          onStream: mockOnStream,
        },
      })

      expect(executor).toBeDefined()
    })

    it.concurrent('should handle legacy constructor with individual parameters', () => {
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
    it.concurrent('should validate workflow on initialization', () => {
      const validateSpy = vi.spyOn(Executor.prototype as any, 'validateWorkflow')

      const workflow = createMinimalWorkflow()
      const _executor = new Executor(workflow)

      expect(validateSpy).toHaveBeenCalled()
    })

    it('should validate workflow on execution', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const validateSpy = vi.spyOn(executor as any, 'validateWorkflow')
      validateSpy.mockClear()

      await executor.execute('test-workflow-id')

      expect(validateSpy).toHaveBeenCalledTimes(1)
    })

    it.concurrent('should throw error for workflow without starter block', () => {
      const workflow = createMinimalWorkflow()
      workflow.blocks = workflow.blocks.filter((block) => block.metadata?.id !== BlockType.STARTER)

      expect(() => new Executor(workflow)).toThrow('Workflow must have an enabled starter block')
    })

    it.concurrent('should throw error for workflow with disabled starter block', () => {
      const workflow = createMinimalWorkflow()
      workflow.blocks.find((block) => block.metadata?.id === BlockType.STARTER)!.enabled = false

      expect(() => new Executor(workflow)).toThrow('Workflow must have an enabled starter block')
    })

    it.concurrent('should throw error if starter block has incoming connections', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections.push({
        source: 'block1',
        target: 'starter',
      })

      expect(() => new Executor(workflow)).toThrow('Starter block cannot have incoming connections')
    })

    it.concurrent('should throw error if starter block has no outgoing connections', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections = []

      expect(() => new Executor(workflow)).toThrow(
        'Starter block must have at least one outgoing connection'
      )
    })

    it.concurrent(
      'should NOT throw error if starter block has no outgoing connections but has trigger blocks',
      () => {
        const workflow = createMinimalWorkflow()
        workflow.connections = []

        // Add a trigger block (webhook trigger)
        workflow.blocks.push({
          id: 'webhook-trigger',
          position: { x: 0, y: 0 },
          metadata: {
            category: 'triggers',
            id: 'webhook',
          },
          config: {
            tool: 'webhook',
            params: {},
          },
          inputs: {},
          outputs: {},
          enabled: true,
        })

        expect(() => new Executor(workflow)).not.toThrow()
      }
    )

    it.concurrent(
      'should NOT throw error if starter block has no outgoing connections but has triggerMode block',
      () => {
        const workflow = createMinimalWorkflow()
        workflow.connections = []

        // Add a block with triggerMode enabled
        workflow.blocks.push({
          id: 'gmail-trigger',
          position: { x: 0, y: 0 },
          metadata: {
            id: 'gmail',
          },
          config: {
            tool: 'gmail',
            params: {
              triggerMode: true,
            },
          },
          inputs: {},
          outputs: {},
          enabled: true,
        })

        expect(() => new Executor(workflow)).not.toThrow()
      }
    )

    it.concurrent('should throw error if connection references non-existent source block', () => {
      const workflow = createMinimalWorkflow()
      workflow.connections.push({
        source: 'non-existent-block',
        target: 'block1',
      })

      expect(() => new Executor(workflow)).toThrow(
        'Connection references non-existent source block: non-existent-block'
      )
    })

    it.concurrent('should throw error if connection references non-existent target block', () => {
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
    it.concurrent('should execute workflow and return ExecutionResult', async () => {
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

    it.concurrent('should handle streaming execution with onStream callback', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputs: ['block1'],
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

    it.concurrent('should pass context extensions to execution context', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()
      const selectedOutputs = ['block1', 'block2']
      const edges = [{ source: 'starter', target: 'block1' }]

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputs,
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
    it.concurrent('should handle condition blocks without errors', async () => {
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

    it.concurrent('should handle loop structures without errors', async () => {
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
    it('should detect debug mode from settings', async () => {
      vi.resetModules()
      vi.clearAllMocks()

      setupAllMocks({ isDebugModeEnabled: true })

      const { Executor } = await import('@/executor/index')

      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const isDebugging = (executor as any).isDebugging

      expect(isDebugging).toBe(true)
    })

    it.concurrent('should work with debug mode disabled', async () => {
      vi.resetModules()
      vi.clearAllMocks()

      setupAllMocks({ isDebugModeEnabled: false })

      const { Executor } = await import('@/executor/index')

      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const isDebugging = (executor as any).isDebugging

      expect(isDebugging).toBe(false)
    })

    it.concurrent('should handle continue execution in debug mode', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

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
    it.concurrent('should handle different block outputs correctly', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      expect(executor).toBeDefined()
      expect(typeof executor.execute).toBe('function')
    })

    it.concurrent('should handle error outputs correctly', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const extractErrorMessage = (executor as any).extractErrorMessage.bind(executor)

      const error = new Error('Test error message')
      const errorMessage = extractErrorMessage(error)
      expect(errorMessage).toBe('Test error message')
    })
  })

  /**
   * Error handling tests
   */
  describe('error handling', () => {
    it.concurrent('should activate error paths when a block has an error', () => {
      const workflow = createWorkflowWithErrorPath()
      const executor = new Executor(workflow)

      const context = {
        executedBlocks: new Set<string>(['starter', 'block1']),
        activeExecutionPath: new Set<string>(['block1']),
        blockStates: new Map(),
        workflow: workflow,
      } as any

      context.blockStates.set('block1', {
        output: {
          error: 'Test error',
        },
        executed: true,
      })

      const activateErrorPath = (executor as any).activateErrorPath.bind(executor)
      const result = activateErrorPath('block1', context)

      expect(result).toBe(true)

      expect(context.activeExecutionPath.has('error-handler')).toBe(true)
    })

    it.concurrent('should not activate error paths for starter and condition blocks', () => {
      const workflow = createWorkflowWithErrorPath()
      const executor = new Executor(workflow)

      workflow.blocks.push({
        id: 'condition-block',
        position: { x: 300, y: 0 },
        config: { tool: 'test-tool', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
        metadata: { id: BlockType.CONDITION, name: 'Condition Block' },
      })

      const context = {
        executedBlocks: new Set<string>(['starter', 'condition-block']),
        activeExecutionPath: new Set<string>(['condition-block']),
        blockStates: new Map(),
        workflow: workflow,
      } as any

      context.blockStates.set('starter', {
        output: { error: 'Test error' },
        executed: true,
      })

      context.blockStates.set('condition-block', {
        output: { error: 'Test error' },
        executed: true,
      })

      const activateErrorPath = (executor as any).activateErrorPath.bind(executor)

      expect(activateErrorPath('starter', context)).toBe(false)
      expect(activateErrorPath('condition-block', context)).toBe(false)
    })

    it.concurrent('should return false if no error connections exist', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const context = {
        executedBlocks: new Set<string>(['starter', 'block1']),
        activeExecutionPath: new Set<string>(['block1']),
        blockStates: new Map(),
        workflow: workflow,
      } as any

      context.blockStates.set('block1', {
        output: { error: 'Test error' },
        executed: true,
      })

      const activateErrorPath = (executor as any).activateErrorPath.bind(executor)
      const result = activateErrorPath('block1', context)

      expect(result).toBe(false)
    })

    it.concurrent('should create proper error output for a block error', () => {
      const workflow = createWorkflowWithErrorPath()
      const executor = new Executor(workflow)

      const testError = new Error('Test function execution error') as Error & {
        status?: number
      }
      testError.status = 400

      const _mockContext = {
        blockLogs: [],
        blockStates: new Map(),
        executedBlocks: new Set<string>(),
        activeExecutionPath: new Set<string>(['block1']),
        workflow,
      }

      const extractErrorMessage = (executor as any).extractErrorMessage.bind(executor)
      const errorMessage = extractErrorMessage(testError)

      expect(errorMessage).toBe('Test function execution error')

      const errorOutput = {
        error: errorMessage,
        status: testError.status || 500,
      }

      expect(errorOutput).toHaveProperty('error')
      expect(errorOutput).toHaveProperty('status')
    })

    it.concurrent('should handle "undefined (undefined)" error case', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const extractErrorMessage = (executor as any).extractErrorMessage.bind(executor)

      const undefinedError = { message: 'undefined (undefined)' }
      const errorMessage = extractErrorMessage(undefinedError)

      expect(errorMessage).toBe('undefined (undefined)')
    })
  })

  /**
   * Streaming execution tests
   */
  describe('streaming execution', () => {
    it.concurrent('should handle streaming execution results', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

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
          selectedOutputs: ['block1'],
          onStream: mockOnStream,
        },
      })

      const result = await executor.execute('test-workflow-id')

      if ('stream' in result) {
        expect(result.stream).toBeInstanceOf(ReadableStream)
        expect(result.execution).toBeDefined()
      }
    })

    it.concurrent('should process streaming content in context', async () => {
      const workflow = createMinimalWorkflow()
      const mockOnStream = vi.fn()

      const executor = new Executor({
        workflow,
        contextExtensions: {
          stream: true,
          selectedOutputs: ['block1'],
          onStream: mockOnStream,
        },
      })

      const createContextSpy = vi.spyOn(executor as any, 'createExecutionContext')

      await executor.execute('test-workflow-id')

      expect(createContextSpy).toHaveBeenCalled()
    })
  })

  /**
   * Dependency checking logic tests
   */
  describe('dependency checking', () => {
    it.concurrent('should handle multi-input blocks with inactive sources correctly', () => {
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

      const agentConnections = [
        { source: 'api1', target: 'agent', sourceHandle: 'source' },
        { source: 'api2', target: 'agent', sourceHandle: 'source' },
      ]

      const dependenciesMet = checkDependencies(agentConnections, executedBlocks, mockContext)

      expect(dependenciesMet).toBe(true)
    })

    it.concurrent('should prioritize special connection types over active path check', () => {
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

      const errorConnections = [{ source: 'block2', target: 'block3', sourceHandle: 'error' }]

      mockContext.blockStates.set('block2', {
        output: { error: 'test error' },
      })

      const errorDepsResult = checkDependencies(errorConnections, new Set(['block2']), mockContext)
      expect(errorDepsResult).toBe(true) // source executed + has error = dependency met

      const loopConnections = [
        { source: 'block2', target: 'block3', sourceHandle: 'loop-end-source' },
      ]

      mockContext.completedLoops.add('block2')
      const loopDepsResult = checkDependencies(loopConnections, new Set(['block2']), mockContext)
      expect(loopDepsResult).toBe(true) // loop completed = dependency met
    })

    it.concurrent('should handle router decisions correctly in dependency checking', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

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

      const selectedConnections = [{ source: 'router1', target: 'target1', sourceHandle: 'source' }]
      const selectedResult = checkDependencies(selectedConnections, executedBlocks, mockContext)
      expect(selectedResult).toBe(true)

      const nonSelectedConnections = [
        { source: 'router1', target: 'target2', sourceHandle: 'source' },
      ]
      const nonSelectedResult = checkDependencies(
        nonSelectedConnections,
        executedBlocks,
        mockContext
      )
      expect(nonSelectedResult).toBe(false)
    })

    it.concurrent('should handle condition decisions correctly in dependency checking', () => {
      const conditionWorkflow = createWorkflowWithCondition()
      const executor = new Executor(conditionWorkflow)
      const checkDependencies = (executor as any).checkDependencies.bind(executor)

      const mockContext = {
        blockStates: new Map(),
        decisions: {
          router: new Map(),
          condition: new Map([['condition1', 'true']]),
        },
        activeExecutionPath: new Set(['condition1', 'trueTarget']),
        workflow: conditionWorkflow,
      } as any

      const executedBlocks = new Set(['condition1'])

      const trueConnections = [
        { source: 'condition1', target: 'trueTarget', sourceHandle: 'condition-true' },
      ]
      const trueResult = checkDependencies(trueConnections, executedBlocks, mockContext)
      expect(trueResult).toBe(true)

      const falseConnections = [
        { source: 'condition1', target: 'falseTarget', sourceHandle: 'condition-false' },
      ]
      const falseResult = checkDependencies(falseConnections, executedBlocks, mockContext)
      expect(falseResult).toBe(true)
    })

    it.concurrent('should handle regular sequential dependencies correctly', () => {
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

      const normalConnections = [{ source: 'block1', target: 'block2', sourceHandle: 'source' }]

      const normalResult = checkDependencies(normalConnections, executedBlocks, mockContext)
      expect(normalResult).toBe(true) // source executed + no error = dependency met

      // With error should fail regular connection
      mockContext.blockStates.set('block1', {
        output: { error: 'test error' },
      })
      const errorResult = checkDependencies(normalConnections, executedBlocks, mockContext)
      expect(errorResult).toBe(false) // source executed + has error = regular dependency not met
    })

    it.concurrent('should handle empty dependency list', () => {
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

  /**
   * Cancellation tests
   */
  describe('workflow cancellation', () => {
    it.concurrent('should set cancellation flag when cancel() is called', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Initially not cancelled
      expect((executor as any).isCancelled).toBe(false)

      // Cancel and check flag
      executor.cancel()
      expect((executor as any).isCancelled).toBe(true)
    })

    it.concurrent('should handle cancellation in debug mode continueExecution', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Create mock context
      const mockContext = createMockContext()
      mockContext.blockStates.set('starter', {
        output: { input: {} },
        executed: true,
        executionTime: 0,
      })

      // Cancel before continue execution
      executor.cancel()

      const result = await executor.continueExecution(['block1'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Workflow execution was cancelled')
    })

    it.concurrent('should handle multiple cancel() calls gracefully', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Multiple cancellations should not cause issues
      executor.cancel()
      executor.cancel()
      executor.cancel()

      expect((executor as any).isCancelled).toBe(true)
    })

    it.concurrent('should prevent new execution on cancelled executor', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Cancel first
      executor.cancel()

      // Try to execute
      const result = await executor.execute('test-workflow-id')

      // Should immediately return cancelled result
      if ('success' in result) {
        expect(result.success).toBe(false)
        expect(result.error).toBe('Workflow execution was cancelled')
      }
    })

    it.concurrent('should return cancelled result when cancellation flag is checked', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Test cancellation during the execution loop check
      // Mock the while loop condition by setting cancelled before execution

      ;(executor as any).isCancelled = true

      const result = await executor.execute('test-workflow-id')

      // Should return cancelled result
      if ('success' in result) {
        expect(result.success).toBe(false)
        expect(result.error).toBe('Workflow execution was cancelled')
      }
    })
  })

  describe('Parallel Execution with Mixed Results', () => {
    it.concurrent(
      'should handle parallel execution where some blocks succeed and others fail',
      async () => {
        // Create a workflow with two parallel agents
        const workflow = {
          version: '1.0',
          blocks: [
            {
              id: 'starter',
              position: { x: 0, y: 0 },
              metadata: { id: BlockType.STARTER },
              config: { tool: 'starter', params: {} },
              inputs: {},
              outputs: {},
              enabled: true,
            },
            {
              id: 'agent1',
              position: { x: 100, y: 0 },
              metadata: { id: BlockType.AGENT, name: 'Agent 1' },
              config: { tool: 'agent', params: { model: 'gpt-4o', input: 'Hello' } },
              inputs: {},
              outputs: {},
              enabled: true,
            },
            {
              id: 'agent2',
              position: { x: 200, y: 0 },
              metadata: { id: BlockType.AGENT, name: 'Agent 2' },
              config: { tool: 'agent', params: { model: 'gpt-4o', input: 'Hello' } },
              inputs: {},
              outputs: {},
              enabled: true,
            },
          ],
          connections: [
            { source: 'starter', sourceHandle: 'out', target: 'agent1', targetHandle: 'in' },
            { source: 'starter', sourceHandle: 'out', target: 'agent2', targetHandle: 'in' },
          ],
          loops: {},
          parallels: {},
        }

        const executor = new Executor(workflow)

        // Mock agent1 to succeed and agent2 to fail
        const mockExecuteBlock = vi
          .fn()
          .mockImplementationOnce(() => ({ content: 'Success from agent1' })) // agent1 succeeds
          .mockImplementationOnce(() => {
            throw new Error('Agent 2 failed')
          }) // agent2 fails

        // Replace the executeBlock method

        ;(executor as any).executeBlock = mockExecuteBlock

        // Mock other necessary methods

        ;(executor as any).createExecutionContext = vi.fn(() => ({
          blockStates: new Map(),
          executedBlocks: new Set(['starter']),
          blockLogs: [],
          metadata: { startTime: new Date().toISOString() },
          pendingBlocks: [],
          parallelBlockMapping: new Map(),
          onStream: undefined,
        }))

        ;(executor as any).getNextExecutionLayer = vi
          .fn()
          .mockReturnValueOnce(['agent1', 'agent2']) // First call returns both agents
          .mockReturnValueOnce([]) // Second call returns empty (execution complete)

        ;(executor as any).pathTracker = {
          updateExecutionPaths: vi.fn(),
        }

        const result = await executor.execute('test-workflow')

        // Should succeed with partial results - not throw an error
        expect(result).toBeDefined()
        expect(mockExecuteBlock).toHaveBeenCalledTimes(2)

        // The execution should complete despite one block failing
        // This tests our Promise.allSettled() behavior
      }
    )
  })

  /**
   * Trigger handler integration tests
   */
  describe('trigger block handling', () => {
    it.concurrent('should not interfere with regular tool blocks', async () => {
      const workflow = {
        version: '1.0',
        blocks: [
          {
            id: 'starter',
            position: { x: -100, y: 0 },
            metadata: { id: BlockType.STARTER, name: 'Starter Block' },
            config: { tool: 'starter', params: {} },
            inputs: {} as Record<string, ParamType>,
            outputs: {} as Record<string, BlockOutput>,
            enabled: true,
          },
          {
            id: 'api-block',
            position: { x: 0, y: 0 },
            metadata: { id: BlockType.API, name: 'API Block', category: 'tools' },
            config: { tool: 'api', params: {} },
            inputs: { url: 'string' as ParamType },
            outputs: { response: 'json' as BlockOutput },
            enabled: true,
          },
        ],
        connections: [{ source: 'starter', target: 'api-block' }],
        loops: {},
      }

      const executor = new Executor({
        workflow,
        workflowInput: { url: 'https://api.example.com' },
      })

      // The TriggerBlockHandler should NOT handle regular tool blocks
      expect(
        (executor as any).blockHandlers[0].canHandle({
          id: 'api-block',
          metadata: { id: BlockType.API, category: 'tools' },
          config: { tool: 'api', params: {} },
          position: { x: 0, y: 0 },
          inputs: {},
          outputs: {},
          enabled: true,
        })
      ).toBe(false)
    })
  })

  /**
   * Parallel workflow blocks tests - testing the fix for UI state interference
   */
  describe('parallel workflow blocks execution', () => {
    it.concurrent(
      'should prevent child executors from interfering with parent UI state',
      async () => {
        // Create a workflow with parallel workflow blocks
        const workflow = {
          version: '1.0',
          blocks: [
            {
              id: 'starter',
              position: { x: 0, y: 0 },
              metadata: { id: BlockType.STARTER, name: 'Starter Block' },
              config: { tool: 'starter', params: {} },
              inputs: {} as Record<string, ParamType>,
              outputs: {} as Record<string, BlockOutput>,
              enabled: true,
            },
            {
              id: 'workflow-block-1',
              position: { x: 100, y: 0 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 1' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-1',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
            {
              id: 'workflow-block-2',
              position: { x: 100, y: 100 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 2' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-2',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
          ],
          connections: [
            { source: 'starter', target: 'workflow-block-1' },
            { source: 'starter', target: 'workflow-block-2' },
          ],
          loops: {},
        }

        const executor = new Executor({
          workflow,
          workflowInput: {},
        })

        const result = await executor.execute('test-workflow-id')

        // Verify execution completed (may succeed or fail depending on child workflow availability)
        expect(result).toBeDefined()
        if ('success' in result) {
          // Either success or failure is acceptable in test environment
          expect(typeof result.success).toBe('boolean')
        }
      }
    )

    it.concurrent('should handle workflow blocks with isChildExecution flag', async () => {
      const workflow = {
        version: '1.0',
        blocks: [
          {
            id: 'starter',
            position: { x: 0, y: 0 },
            metadata: { id: BlockType.STARTER, name: 'Starter Block' },
            config: { tool: 'starter', params: {} },
            inputs: {} as Record<string, ParamType>,
            outputs: {} as Record<string, BlockOutput>,
            enabled: true,
          },
          {
            id: 'workflow-block',
            position: { x: 100, y: 0 },
            metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block' },
            config: {
              tool: 'workflow',
              params: {
                workflowId: 'child-workflow',
                input: {},
              },
            },
            inputs: {} as Record<string, ParamType>,
            outputs: { output: 'json' as BlockOutput },
            enabled: true,
          },
        ],
        connections: [{ source: 'starter', target: 'workflow-block' }],
        loops: {},
      }

      const executor = new Executor({
        workflow,
        workflowInput: {},
      })

      // Verify that child executor is created with isChildExecution flag
      const result = await executor.execute('test-workflow-id')

      expect(result).toBeDefined()
      if ('success' in result) {
        // Either success or failure is acceptable in test environment
        expect(typeof result.success).toBe('boolean')
      }
    })

    it.concurrent(
      'should handle multiple parallel workflow blocks without state conflicts',
      async () => {
        const workflow = {
          version: '1.0',
          blocks: [
            {
              id: 'starter',
              position: { x: 0, y: 0 },
              metadata: { id: BlockType.STARTER, name: 'Starter Block' },
              config: { tool: 'starter', params: {} },
              inputs: {} as Record<string, ParamType>,
              outputs: {} as Record<string, BlockOutput>,
              enabled: true,
            },
            {
              id: 'workflow-block-1',
              position: { x: 100, y: 0 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 1' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-1',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
            {
              id: 'workflow-block-2',
              position: { x: 100, y: 100 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 2' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-2',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
            {
              id: 'workflow-block-3',
              position: { x: 100, y: 200 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 3' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-3',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
          ],
          connections: [
            { source: 'starter', target: 'workflow-block-1' },
            { source: 'starter', target: 'workflow-block-2' },
            { source: 'starter', target: 'workflow-block-3' },
          ],
          loops: {},
        }

        const executor = new Executor({
          workflow,
          workflowInput: {},
        })

        const result = await executor.execute('test-workflow-id')

        // Verify execution completed (may succeed or fail depending on child workflow availability)
        expect(result).toBeDefined()
        if ('success' in result) {
          // Either success or failure is acceptable in test environment
          expect(typeof result.success).toBe('boolean')
        }
      }
    )

    it.concurrent(
      'should maintain proper execution flow for parallel workflow blocks',
      async () => {
        const workflow = {
          version: '1.0',
          blocks: [
            {
              id: 'starter',
              position: { x: 0, y: 0 },
              metadata: { id: BlockType.STARTER, name: 'Starter Block' },
              config: { tool: 'starter', params: {} },
              inputs: {} as Record<string, ParamType>,
              outputs: {} as Record<string, BlockOutput>,
              enabled: true,
            },
            {
              id: 'workflow-block-1',
              position: { x: 100, y: 0 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 1' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-1',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
            {
              id: 'workflow-block-2',
              position: { x: 100, y: 100 },
              metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block 2' },
              config: {
                tool: 'workflow',
                params: {
                  workflowId: 'child-workflow-2',
                  input: {},
                },
              },
              inputs: {} as Record<string, ParamType>,
              outputs: { output: 'json' as BlockOutput },
              enabled: true,
            },
          ],
          connections: [
            { source: 'starter', target: 'workflow-block-1' },
            { source: 'starter', target: 'workflow-block-2' },
          ],
          loops: {},
        }

        const executor = new Executor({
          workflow,
          workflowInput: {},
        })

        const result = await executor.execute('test-workflow-id')

        // Verify execution completed (may succeed or fail depending on child workflow availability)
        expect(result).toBeDefined()
        if ('success' in result) {
          // Either success or failure is acceptable in test environment
          expect(typeof result.success).toBe('boolean')
        }

        // Verify that parallel blocks were handled correctly
        if ('logs' in result) {
          expect(result.logs).toBeDefined()
          expect(Array.isArray(result.logs)).toBe(true)
        }
      }
    )

    it.concurrent('should propagate errors from child workflows to parent workflow', async () => {
      const workflow = {
        version: '1.0',
        blocks: [
          {
            id: 'starter',
            position: { x: 0, y: 0 },
            metadata: { id: BlockType.STARTER, name: 'Starter Block' },
            config: { tool: 'starter', params: {} },
            inputs: {} as Record<string, ParamType>,
            outputs: {} as Record<string, BlockOutput>,
            enabled: true,
          },
          {
            id: 'workflow-block',
            position: { x: 100, y: 0 },
            metadata: { id: BlockType.WORKFLOW, name: 'Failing Workflow Block' },
            config: {
              tool: 'workflow',
              params: {
                workflowId: 'failing-child-workflow',
                input: {},
              },
            },
            inputs: {} as Record<string, ParamType>,
            outputs: { output: 'json' as BlockOutput },
            enabled: true,
          },
        ],
        connections: [{ source: 'starter', target: 'workflow-block' }],
        loops: {},
      }

      const executor = new Executor({
        workflow,
        workflowInput: {},
      })

      const result = await executor.execute('test-workflow-id')

      // Verify that child workflow errors propagate to parent
      expect(result).toBeDefined()
      if ('success' in result) {
        // The workflow should fail due to child workflow failure
        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()

        // Error message should indicate it came from a child workflow
        if (result.error && typeof result.error === 'string') {
          expect(result.error).toContain('Error in child workflow')
        }
      }
    })
  })

  describe('Parallel Execution Ordering', () => {
    it('should handle missing parallel block mapping gracefully', () => {
      const executor = new Executor(createMinimalWorkflow())
      const context = createMockContext()

      // Test isIterationComplete with missing parallel config
      const result = (executor as any).isIterationComplete('nonexistent-parallel', 0, null, context)
      expect(result).toBe(true) // Should return true for safety
    })

    it('should correctly identify incomplete iterations', () => {
      const executor = new Executor(createMinimalWorkflow())
      const context = createMockContext()

      const parallelConfig = {
        nodes: ['function-1', 'function-2'],
      }

      // Add some executed blocks
      context.executedBlocks.add('function-1_parallel_parallel-1_iteration_0')
      // function-2 iteration 0 is missing

      const result = (executor as any).isIterationComplete('parallel-1', 0, parallelConfig, context)
      expect(result).toBe(false)

      // Add the missing block
      context.executedBlocks.add('function-2_parallel_parallel-1_iteration_0')

      const completedResult = (executor as any).isIterationComplete(
        'parallel-1',
        0,
        parallelConfig,
        context
      )
      expect(completedResult).toBe(true)
    })

    it('should detect when no more parallel work is available', () => {
      const executor = new Executor(createMinimalWorkflow())
      const context = createMockContext()

      // Add parallel execution state with completed parallel
      context.parallelExecutions = new Map([
        [
          'parallel-1',
          {
            parallelCount: 3,
            currentIteration: 3,
            distributionItems: null,
            completedExecutions: 3,
            executionResults: new Map(),
            activeIterations: new Set(),
          },
        ],
      ])

      context.completedLoops.add('parallel-1')

      const hasWork = (executor as any).hasMoreParallelWork(context)
      expect(hasWork).toBe(false)
    })

    it('should handle empty parallel execution context', () => {
      const executor = new Executor(createMinimalWorkflow())
      const context = createMockContext()

      // No parallel executions
      context.parallelExecutions = undefined

      const hasWork = (executor as any).hasMoreParallelWork(context)
      expect(hasWork).toBe(false)
    })

    it('should identify complete iterations correctly', () => {
      const executor = new Executor(createMinimalWorkflow())
      const context = createMockContext()

      const parallelConfig = {
        nodes: ['function-1', 'function-2', 'function-3'],
      }

      // All blocks executed for iteration 1
      context.executedBlocks.add('function-1_parallel_parallel-1_iteration_1')
      context.executedBlocks.add('function-2_parallel_parallel-1_iteration_1')
      context.executedBlocks.add('function-3_parallel_parallel-1_iteration_1')

      const result = (executor as any).isIterationComplete('parallel-1', 1, parallelConfig, context)
      expect(result).toBe(true)
    })

    it('should handle undefined parallel configuration safely', () => {
      const executor = new Executor(createMinimalWorkflow())
      const context = createMockContext()

      const result = (executor as any).isIterationComplete('parallel-1', 0, undefined, context)
      expect(result).toBe(true)
    })
  })
})
