import { Executor } from '../../executor'
import {
  createMinimalWorkflow,
  createWorkflowWithCondition,
  createWorkflowWithLoop,
} from './fixtures/workflows'

// Use automatic mocking
jest.mock('../../executor/resolver', () => require('../__mocks__/executor/resolver'))
jest.mock('../../executor/loops', () => require('../__mocks__/executor/loops'))
jest.mock('../../executor/path', () => require('../__mocks__/executor/path'))
jest.mock('../../executor/handlers', () => require('../__mocks__/executor/handlers'))
jest.mock('@/stores/console/store')
jest.mock('@/stores/execution/store')

describe('Executor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('should initialize correctly', () => {
    const workflow = createMinimalWorkflow()
    const executor = new Executor(workflow)
    expect(executor).toBeDefined()
  })

  test('should validate workflow on execution', async () => {
    const workflow = createMinimalWorkflow()
    const executor = new Executor(workflow)
    const validateSpy = jest.spyOn(executor as any, 'validateWorkflow')

    await executor.execute('test-workflow-id')

    expect(validateSpy).toHaveBeenCalled()
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

  test('should execute blocks in correct order', async () => {
    const workflow = createMinimalWorkflow()
    const executor = new Executor(workflow)

    const result = await executor.execute('test-workflow-id')

    expect(result.success).toBe(true)
    // Add more assertions based on expected execution order
  })

  test('should handle loops correctly', async () => {
    const workflow = createWorkflowWithLoop()
    const executor = new Executor(workflow)

    const result = await executor.execute('test-workflow-id')

    expect(result.success).toBe(true)
    // Add assertions for loop execution
  })

  test('should follow conditional paths correctly', async () => {
    const workflow = createWorkflowWithCondition()
    const executor = new Executor(workflow)

    // Mock condition decision
    const { useExecutionStore } = require('@/stores/execution/store')
    useExecutionStore.getState().decisions = {
      condition: new Map([['condition1', 'true']]),
    }

    const result = await executor.execute('test-workflow-id')

    expect(result.success).toBe(true)
    // Add assertions for conditional path execution
  })

  test('should handle errors gracefully', async () => {
    const workflow = createMinimalWorkflow()
    const executor = new Executor(workflow)

    // Mock handler to throw error
    const { GenericBlockHandler } = require('../__mocks__/executor/handlers')
    const mockHandler = GenericBlockHandler.mock.results[0].value
    mockHandler.execute.mockRejectedValueOnce(new Error('Test error'))

    const result = await executor.execute('test-workflow-id')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Test error')
  })
})
