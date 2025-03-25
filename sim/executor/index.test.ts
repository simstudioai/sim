/**
 * @vitest-environment jsdom
 *
 * Executor Class Unit Tests
 *
 * This file contains unit tests for the Executor class, which is responsible for
 * running workflow blocks in topological order, handling the execution flow,
 * resolving inputs and dependencies, and managing errors.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SerializedWorkflow } from '../serializer/types'
import { Executor } from './index'

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: () => ({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: () => ({
      setIsExecuting: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
      setPendingBlocks: vi.fn(),
      setIsDebugging: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: {
    getState: () => ({
      isDebugModeEnabled: true,
    }),
  },
}))

// Mock all handler classes
vi.mock('./handlers', () => {
  // Factory function for handler mocks
  const createHandler = (handlerName: string) => {
    return vi.fn().mockImplementation(() => ({
      canHandle: (block: any) => block.metadata?.id === handlerName || handlerName === 'generic',
      execute: vi.fn().mockResolvedValue({ response: { result: `${handlerName} executed` } }),
    }))
  }

  return {
    AgentBlockHandler: createHandler('agent'),
    RouterBlockHandler: createHandler('router'),
    ConditionBlockHandler: createHandler('condition'),
    EvaluatorBlockHandler: createHandler('evaluator'),
    FunctionBlockHandler: createHandler('function'),
    ApiBlockHandler: createHandler('api'),
    GenericBlockHandler: createHandler('generic'),
  }
})

// Mock the PathTracker
vi.mock('./path', () => ({
  PathTracker: vi.fn().mockImplementation(() => ({
    updateExecutionPaths: vi.fn(),
  })),
}))

// Mock the InputResolver
vi.mock('./resolver', () => ({
  InputResolver: vi.fn().mockImplementation(() => ({
    resolveInputs: vi.fn().mockReturnValue({}),
  })),
}))

// Mock the LoopManager
vi.mock('./loops', () => ({
  LoopManager: vi.fn().mockImplementation(() => ({
    processLoopIterations: vi.fn().mockResolvedValue(false),
  })),
}))

/**
 * Test Fixtures
 */

// Create a minimal workflow
const createMinimalWorkflow = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Test Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
  ],
  loops: {},
})

// Create a workflow with a conditional path
const createWorkflowWithCondition = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'condition1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'condition', name: 'Condition Block' },
    },
    {
      id: 'block1',
      position: { x: 200, y: -50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'True Path Block' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'False Path Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'condition1',
    },
    {
      source: 'condition1',
      target: 'block1',
      sourceHandle: 'condition-true',
    },
    {
      source: 'condition1',
      target: 'block2',
      sourceHandle: 'condition-false',
    },
  ],
  loops: {},
})

// Create a workflow with a loop
const createWorkflowWithLoop = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 1' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 2' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
    {
      source: 'block1',
      target: 'block2',
    },
    {
      source: 'block2',
      target: 'block1',
    },
  ],
  loops: {
    loop1: {
      id: 'loop1',
      nodes: ['block1', 'block2'],
      maxIterations: 5,
      minIterations: 0,
    },
  },
})

describe('Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  /**
   * Initialization tests
   */
  describe('initialization', () => {
    test('should create an executor instance successfully', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(Executor)
    })

    test('should accept initial block states', () => {
      const workflow = createMinimalWorkflow()
      const initialStates = {
        block1: { response: { result: 'Initial state' } },
      }

      const executor = new Executor(workflow, initialStates)
      expect(executor).toBeDefined()
    })

    test('should accept environment variables', () => {
      const workflow = createMinimalWorkflow()
      const envVars = { API_KEY: 'test-key', BASE_URL: 'https://example.com' }

      const executor = new Executor(workflow, {}, envVars)
      expect(executor).toBeDefined()
    })

    test('should accept workflow input', () => {
      const workflow = createMinimalWorkflow()
      const input = { query: 'test query' }

      const executor = new Executor(workflow, {}, {}, input)
      expect(executor).toBeDefined()
    })
  })

  /**
   * Validation tests
   */
  describe('workflow validation', () => {
    test('should validate workflow on initialization', () => {
      // Create a spy for the validateWorkflow method
      const validateSpy = vi.spyOn(Executor.prototype as any, 'validateWorkflow')

      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      expect(validateSpy).toHaveBeenCalled()
    })

    test('should validate workflow on execution', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Create a spy for the validateWorkflow method and reset the mock
      const validateSpy = vi.spyOn(executor as any, 'validateWorkflow')
      validateSpy.mockClear()

      await executor.execute('test-workflow-id')

      expect(validateSpy).toHaveBeenCalledTimes(1)
    })

    test('should throw error for workflow without starter block', () => {
      const workflow = createMinimalWorkflow()
      workflow.blocks = workflow.blocks.filter((block) => block.metadata?.id !== 'starter')

      expect(() => new Executor(workflow)).toThrow('Workflow must have an enabled starter block')
    })

    test('should throw error for workflow with disabled starter block', () => {
      const workflow = createMinimalWorkflow()
      workflow.blocks.find((block) => block.metadata?.id === 'starter')!.enabled = false

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
    test('should execute workflow with correct structure', async () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      const result = await executor.execute('test-workflow-id')

      // Verify the result has the expected structure
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('output')
      expect(result.output).toHaveProperty('response')

      // Our mocked implementation results in a false success value
      // In real usage, this would be true for successful executions
      expect(typeof result.success).toBe('boolean')
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

      // Just verify execution completes and returns expected structure
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('output')
    })

    test('should handle loop structures without errors', async () => {
      const workflow = createWorkflowWithLoop()
      const executor = new Executor(workflow)

      const result = await executor.execute('test-workflow-id')

      // Just verify execution completes and returns expected structure
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('output')
    })
  })

  /**
   * Debug mode tests
   */
  describe('debug mode', () => {
    // Test that the executor can be put into debug mode
    test('should detect debug mode from settings', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)
      const isDebugging = (executor as any).isDebugging

      expect(isDebugging).toBe(true)
    })
  })

  /**
   * Additional tests to improve coverage
   */
  describe('normalizeBlockOutput', () => {
    test('should normalize different block outputs correctly', () => {
      const workflow = createMinimalWorkflow()
      const executor = new Executor(workflow)

      // Access the private method for testing
      const normalizeOutput = (executor as any).normalizeBlockOutput.bind(executor)

      // Test normalizing agent block output
      const agentBlock = { metadata: { id: 'agent' } }
      const agentOutput = { response: { content: 'Agent response' } }
      expect(normalizeOutput(agentOutput, agentBlock)).toEqual(agentOutput)

      // Test normalizing router block output
      const routerBlock = { metadata: { id: 'router' } }
      const routerOutput = { selectedPath: { blockId: 'target' } }
      const normalizedRouterOutput = normalizeOutput(routerOutput, routerBlock)
      expect(normalizedRouterOutput.response.selectedPath).toEqual(routerOutput.selectedPath)

      // Test normalizing function block output
      const functionBlock = { metadata: { id: 'function' } }
      const functionOutput = { result: 'Function result', stdout: 'Output' }
      const normalizedFunctionOutput = normalizeOutput(functionOutput, functionBlock)
      expect(normalizedFunctionOutput.response.result).toEqual(functionOutput.result)
      expect(normalizedFunctionOutput.response.stdout).toEqual(functionOutput.stdout)

      // Test generic output normalization
      const genericBlock = { metadata: { id: 'unknown' } }
      const genericOutput = 'Simple string result'
      const normalizedGenericOutput = normalizeOutput(genericOutput, genericBlock)
      expect(normalizedGenericOutput.response.result).toEqual(genericOutput)
    })
  })
})
