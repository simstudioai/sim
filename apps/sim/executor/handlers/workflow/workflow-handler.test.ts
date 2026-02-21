import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const executorMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  lastArgs: undefined as any,
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation((args: any) => {
    executorMocks.lastArgs = args
    return { execute: executorMocks.execute }
  }),
}))

vi.mock('@/serializer', () => ({
  Serializer: class {
    serializeWorkflow() {
      return {
        version: 'test',
        blocks: [],
        connections: [],
        loops: {},
        parallels: {},
      }
    }
  },
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('test-token'),
}))

vi.mock('@/executor/utils/lazy-cleanup', () => ({
  lazyCleanupInputMapping: vi.fn(async (_workflowId: string, _blockId: string, mapping: any) => {
    return mapping
  }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({ workflows: {} }),
  },
}))

// Mock fetch globally
global.fetch = vi.fn()

describe('WorkflowBlockHandler', () => {
  let WorkflowBlockHandler: typeof import('@/executor/handlers/workflow/workflow-handler').WorkflowBlockHandler
  let handler: InstanceType<typeof WorkflowBlockHandler>
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockFetch: Mock

  beforeAll(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    ;({ WorkflowBlockHandler } = await import('@/executor/handlers/workflow/workflow-handler'))
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    // Mock window.location.origin for getBaseUrl()
    ;(global as any).window = {
      location: {
        origin: 'http://localhost:3000',
      },
    }
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
      loopExecutions: new Map(),
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
    executorMocks.lastArgs = undefined

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
                  type: BlockType.STARTER,
                  name: 'Starter',
                  position: { x: 0, y: 0 },
                  subBlocks: {},
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

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'No workflow selected for execution'
      )
    })

    it('should enforce maximum depth limit', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      // Create a deeply nested context (simulate 11 levels deep to exceed the limit of 10)
      const deepContext = {
        ...mockContext,
        workflowId:
          'level1_sub_level2_sub_level3_sub_level4_sub_level5_sub_level6_sub_level7_sub_level8_sub_level9_sub_level10_sub_level11',
      }

      await expect(handler.execute(deepContext, mockBlock, inputs)).rejects.toThrow(
        'Error in child workflow "child-workflow-id": Maximum workflow nesting depth of 10 exceeded'
      )
    })

    it('should handle child workflow not found', async () => {
      const inputs = { workflowId: 'non-existent-workflow' }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Error in child workflow "non-existent-workflow": Child workflow non-existent-workflow not found'
      )
    })

    it('should handle fetch errors gracefully', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Error in child workflow "child-workflow-id": Network error'
      )
    })

    it('normalizes stringified JSON values in inputMapping before starting child workflow', async () => {
      executorMocks.execute.mockResolvedValue({
        success: true,
        output: { ok: true },
      } as any)

      const inputs = {
        workflowId: 'child-workflow-id',
        inputMapping: {
          conversation_id: '149',
          sender: '{"id":10,"email":"user@example.com"}',
          is_active: 'true',
          metadata: '{"nested":"[1,2]"}',
          nullish: 'null',
          invalid: '{bad',
        },
      }

      await expect(handler.execute(mockContext, mockBlock, inputs)).resolves.toMatchObject({
        success: true,
        childWorkflowName: 'Child Workflow',
      })

      expect(executorMocks.lastArgs?.workflowInput).toEqual({
        conversation_id: 149,
        sender: { id: 10, email: 'user@example.com' },
        is_active: true,
        metadata: { nested: [1, 2] },
        nullish: null,
        invalid: '{bad',
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

      await expect((handler as any).loadChildWorkflow(workflowId)).rejects.toThrow(
        'Child workflow invalid-workflow has invalid state'
      )
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
        childTraceSpans: [],
      })
    })

    it('should throw error for failed child output so BlockExecutor can check error port', () => {
      const childResult = {
        success: false,
        error: 'Child workflow failed',
      }

      expect(() =>
        (handler as any).mapChildOutputToParent(childResult, 'child-id', 'Child Workflow', 100)
      ).toThrow('Error in child workflow "Child Workflow": Child workflow failed')

      try {
        ;(handler as any).mapChildOutputToParent(childResult, 'child-id', 'Child Workflow', 100)
      } catch (error: any) {
        expect(error.childTraceSpans).toEqual([])
      }
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
        childTraceSpans: [],
      })
    })
  })
})
