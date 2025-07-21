import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

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
      metadata: { id: BlockType.WORKFLOW, name: 'Test Workflow Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.WORKFLOW, params: {} },
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

    // Setup default fetch mock
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
                  metadata: { id: BlockType.STARTER, name: 'Starter' },
                  position: { x: 0, y: 0 },
                  config: { tool: BlockType.STARTER, params: {} },
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
      const nonWorkflowBlock = { ...mockBlock, metadata: { id: BlockType.FUNCTION } }
      expect(handler.canHandle(nonWorkflowBlock)).toBe(false)
    })
  })

  describe('execute', () => {
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

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        success: false,
        error: 'Cyclic workflow dependency detected: parent-workflow-id_sub_child-workflow-id',
        childWorkflowName: 'child-workflow-id',
      })
    })

    it('should enforce maximum depth limit', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      // Create a deeply nested context (simulate 11 levels deep to exceed the limit of 10)
      const deepContext = {
        ...mockContext,
        workflowId:
          'level1_sub_level2_sub_level3_sub_level4_sub_level5_sub_level6_sub_level7_sub_level8_sub_level9_sub_level10_sub_level11',
      }

      const result = await handler.execute(mockBlock, inputs, deepContext)

      expect(result).toEqual({
        success: false,
        error: 'Maximum workflow nesting depth of 10 exceeded',
        childWorkflowName: 'child-workflow-id',
      })
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
        error: 'Child workflow child-workflow-id not found',
        childWorkflowName: 'child-workflow-id',
      })
    })
  })

  describe('loadChildWorkflow', () => {
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
        output: { data: 'test result' },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        success: true,
        childWorkflowName: 'Child Workflow',
        result: { data: 'test result' },
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
        success: false,
        childWorkflowName: 'Child Workflow',
        error: 'Child workflow failed',
      })
    })

    it('should handle nested response structures', () => {
      const childResult = {
        output: { nested: 'data' },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        success: true,
        childWorkflowName: 'Child Workflow',
        result: { nested: 'data' },
      })
    })
  })
})
