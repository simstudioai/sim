import '../../__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { SerializedBlock } from '@/serializer/types'
import { Serializer } from '@/serializer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { Executor } from '../../index'
import type { ExecutionContext } from '../../types'
import { WorkflowBlockHandler } from './workflow-handler'

// Mock dependencies
vi.mock('@/serializer')
vi.mock('@/stores/workflows/registry/store')
vi.mock('../../index')

const mockSerializer = vi.mocked(Serializer)
const mockUseWorkflowRegistry = vi.mocked(useWorkflowRegistry)
const mockExecutor = vi.mocked(Executor)

// Mock fetch globally
global.fetch = vi.fn()

describe('WorkflowBlockHandler', () => {
  let handler: WorkflowBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockFetch: Mock

  beforeEach(() => {
    handler = new WorkflowBlockHandler()
    mockFetch = global.fetch as Mock

    mockBlock = {
      id: 'workflow-block-1',
      metadata: { id: 'workflow', name: 'Test Workflow Block' },
      position: { x: 0, y: 0 },
      config: { tool: 'workflow', params: {} },
      inputs: { workflowId: 'string' },
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'parent-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      workflow: {
        version: '1.0',
        blocks: [],
        connections: [],
        loops: {},
      },
    }

    // Reset all mocks
    vi.clearAllMocks()

    // Clear the static execution stack
    ;(WorkflowBlockHandler as any).executionStack.clear()

    // Setup default mocks with proper typing
    const mockGetState = vi.fn().mockReturnValue({
      workflows: {
        'child-workflow-id': {
          name: 'Child Workflow',
          id: 'child-workflow-id',
        },
      },
    })
    mockUseWorkflowRegistry.getState = mockGetState

    const mockSerializeWorkflow = vi.fn().mockReturnValue({
      version: '1.0',
      blocks: [
        {
          id: 'starter',
          metadata: { id: 'starter', name: 'Starter' },
          position: { x: 0, y: 0 },
          config: { tool: 'starter', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ],
      connections: [],
      loops: {},
    })
    mockSerializer.prototype.serializeWorkflow = mockSerializeWorkflow

    const mockExecute = vi.fn().mockResolvedValue({
      success: true,
      output: { response: { result: 'Child workflow completed' } },
    })
    mockExecutor.prototype.execute = mockExecute

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            name: 'Child Workflow',
            state: {
              blocks: [
                {
                  id: 'starter',
                  metadata: { id: 'starter', name: 'Starter' },
                  position: { x: 0, y: 0 },
                  config: { tool: 'starter', params: {} },
                  inputs: {},
                  outputs: {},
                  enabled: true,
                },
              ],
              edges: [],
              loops: {},
              parallels: {},
            },
          },
        }),
    })
  })

  describe('canHandle', () => {
    it('should handle workflow blocks', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should not handle non-workflow blocks', () => {
      const nonWorkflowBlock = { ...mockBlock, metadata: { id: 'function' } }
      expect(handler.canHandle(nonWorkflowBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('should execute a child workflow successfully', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockFetch).toHaveBeenCalledWith('/api/workflows/child-workflow-id')
      expect(mockExecutor).toHaveBeenCalled()
      expect(result).toEqual({
        response: {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: { result: 'Child workflow completed' },
        },
      })
    })

    it('should throw error when no workflowId is provided', async () => {
      const inputs = {}

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'No workflow selected for execution'
      )
    })

    it('should detect and prevent cyclic dependencies', async () => {
      const inputs = { workflowId: 'child-workflow-id' }
      
      // Simulate a cycle by adding the execution to the stack
      ;(WorkflowBlockHandler as any).executionStack.add('parent-workflow-id_sub_child-workflow-id')

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'Cyclic workflow dependency detected: parent-workflow-id_sub_child-workflow-id'
      )
    })

    it('should enforce maximum depth limit', async () => {
      const inputs = { workflowId: 'child-workflow-id' }
      
      // Create a deeply nested context (simulate 10 levels deep)
      const deepContext = {
        ...mockContext,
        workflowId: 'level1_sub_level2_sub_level3_sub_level4_sub_level5_sub_level6_sub_level7_sub_level8_sub_level9_sub_level10',
      }

      await expect(handler.execute(mockBlock, inputs, deepContext)).rejects.toThrow(
        'Maximum workflow nesting depth of 10 exceeded'
      )
    })

    it('should handle child workflow not found', async () => {
      const inputs = { workflowId: 'non-existent-workflow' }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        success: false,
        error: 'Child workflow non-existent-workflow not found',
        childWorkflowName: 'non-existent-workflow',
      })
    })

    it('should handle fetch errors gracefully', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        success: false,
        error: 'Network error',
        childWorkflowName: 'Child Workflow',
      })
    })

    it('should clean up execution stack on error', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      const mockExecuteWithError = vi.fn().mockRejectedValueOnce(new Error('Execution failed'))
      mockExecutor.prototype.execute = mockExecuteWithError

      await handler.execute(mockBlock, inputs, mockContext)

      // Verify the execution stack was cleaned up
      expect((WorkflowBlockHandler as any).executionStack.has('parent-workflow-id_sub_child-workflow-id')).toBe(false)
    })

    it('should pass environment variables to child workflow', async () => {
      const inputs = { workflowId: 'child-workflow-id' }
      const contextWithEnvVars = {
        ...mockContext,
        environmentVariables: { API_KEY: 'test-key', DEBUG: 'true' },
      }

      await handler.execute(mockBlock, inputs, contextWithEnvVars)

      expect(mockExecutor).toHaveBeenCalledWith({
        workflow: expect.any(Object),
        workflowInput: {},
        envVarValues: { API_KEY: 'test-key', DEBUG: 'true' },
      })
    })

    it('should include starter block input data in child workflow', async () => {
      const inputs = { workflowId: 'child-workflow-id' }
      
      // Add starter block state to context
      const starterBlockState = {
        output: {
          response: {
            input: { userInput: 'test data', param: 'value' },
          },
        },
        executed: true,
      }
      
      mockContext.blockStates.set('starter', starterBlockState)
      mockContext.workflow!.blocks = [
        {
          id: 'starter',
          metadata: { id: 'starter', name: 'Starter' },
          position: { x: 0, y: 0 },
          config: { tool: 'starter', params: {} },
          inputs: {},
          outputs: {},
          enabled: true,
        },
      ]

      await handler.execute(mockBlock, inputs, mockContext)

      expect(mockExecutor).toHaveBeenCalledWith({
        workflow: expect.any(Object),
        workflowInput: { userInput: 'test data', param: 'value' },
        envVarValues: {},
      })
    })

    it('should handle child workflow execution failure', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      const mockExecuteWithFailure = vi.fn().mockResolvedValueOnce({
        success: false,
        error: 'Child execution failed',
      })
      mockExecutor.prototype.execute = mockExecuteWithFailure

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        response: {
          success: false,
          childWorkflowName: 'Child Workflow',
          error: 'Child execution failed',
        },
      })
    })
  })

  describe('loadChildWorkflow', () => {
    it('should load workflow from API successfully', async () => {
      const workflowId = 'test-workflow-id'

      const result = await (handler as any).loadChildWorkflow(workflowId)

      expect(mockFetch).toHaveBeenCalledWith('/api/workflows/test-workflow-id')
      expect(result).toEqual({
        name: 'Child Workflow',
        serializedState: expect.any(Object),
      })
    })

    it('should return null for 404 responses', async () => {
      const workflowId = 'non-existent-workflow'

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await (handler as any).loadChildWorkflow(workflowId)

      expect(result).toBeNull()
    })

    it('should handle invalid workflow state', async () => {
      const workflowId = 'invalid-workflow'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Invalid Workflow',
              state: null, // Invalid state
            },
          }),
      })

      const result = await (handler as any).loadChildWorkflow(workflowId)

      expect(result).toBeNull()
    })
  })

  describe('mapChildOutputToParent', () => {
    it('should map successful child output correctly', () => {
      const childResult = {
        success: true,
        output: { response: { data: 'test result' } },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        response: {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: { data: 'test result' },
        },
      })
    })

    it('should map failed child output correctly', () => {
      const childResult = {
        success: false,
        error: 'Child workflow failed',
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        response: {
          success: false,
          childWorkflowName: 'Child Workflow',
          error: 'Child workflow failed',
        },
      })
    })

    it('should handle nested response structures', () => {
      const childResult = {
        response: { response: { nested: 'data' } },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        response: {
          success: true,
          childWorkflowName: 'Child Workflow',
          result: { nested: 'data' },
        },
      })
    })
  })
}) 