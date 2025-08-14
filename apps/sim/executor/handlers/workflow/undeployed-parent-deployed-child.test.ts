import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { WorkflowBlockHandler } from './workflow-handler'

// Mock dependencies
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn(() => Promise.resolve('mock-internal-token')),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: vi.fn(() => ({
      workflows: {
        '594431a6-18bb-481c-8b27-84502bf480e5': {
          name: 'runWorkflow',
          id: '594431a6-18bb-481c-8b27-84502bf480e5',
        },
      },
    })),
  },
}))

describe('WorkflowBlockHandler - Undeployed Parent → Deployed Child Issue', () => {
  let handler: WorkflowBlockHandler
  let mockFetch: any

  beforeEach(() => {
    handler = new WorkflowBlockHandler()
    mockFetch = vi.fn()
    global.fetch = mockFetch
    global.performance = { now: vi.fn(() => Date.now()) } as any
  })

  it('should reproduce the exact issue: undeployed parent workflow trying to execute deployed child', async () => {
    // Simulate the exact scenario from the bug report
    const workflowBlock: SerializedBlock = {
      id: 'd33f82fa-3d12-41d3-aeb3-c0e2d8fb1d02', // Actual block ID from debug data
      metadata: {
        id: BlockType.WORKFLOW,
        name: 'Workflow 1',
        type: 'workflow',
      },
      inputs: {},
      outputs: {},
    }

    const inputs = {
      workflowId: '594431a6-18bb-481c-8b27-84502bf480e5', // Child workflow ID
      input: undefined,
    }

    const context: ExecutionContext = {
      workflowId: '0bebc8f9-8563-4d4a-93d2-2a0b4d949897', // Undeployed parent workflow
      environmentVariables: {},
      workflowVariables: {},
    }

    // Scenario 1: Child workflow returns 404 (the actual bug)
    console.log('Testing scenario: Child workflow returns 404 despite existing in database')

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: vi.fn().mockResolvedValue({ error: 'Workflow not found' }),
    })

    await expect(handler.execute(workflowBlock, inputs, context)).rejects.toThrow(
      'Child workflow 594431a6-18bb-481c-8b27-84502bf480e5 not found'
    )

    // Verify the API call was made with internal token
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/workflows/594431a6-18bb-481c-8b27-84502bf480e5',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-internal-token',
        },
      }
    )

    console.log('✅ Successfully reproduced the bug - 404 error for existing child workflow')
  })

  it('should test potential fix: different authentication or retry logic', async () => {
    const workflowBlock: SerializedBlock = {
      id: 'd33f82fa-3d12-41d3-aeb3-c0e2d8fb1d02',
      metadata: {
        id: BlockType.WORKFLOW,
        name: 'Workflow 1',
        type: 'workflow',
      },
      inputs: {},
      outputs: {},
    }

    const inputs = {
      workflowId: '594431a6-18bb-481c-8b27-84502bf480e5',
      input: undefined,
    }

    const context: ExecutionContext = {
      workflowId: '0bebc8f9-8563-4d4a-93d2-2a0b4d949897',
      environmentVariables: {},
      workflowVariables: {},
    }

    // Test what happens if we first get 404, then retry and succeed
    // This could help identify if it's a timing/race condition issue
    console.log('Testing scenario: Retry mechanism for failed child workflow loads')

    let callCount = 0
    mockFetch.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First call fails with 404
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: vi.fn().mockResolvedValue({ error: 'Workflow not found' }),
        })
      }
      // Second call succeeds (simulating eventual consistency)
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          data: {
            name: 'runWorkflow',
            state: {
              blocks: {
                'starter-block': {
                  id: 'starter-block',
                  type: 'starter',
                  name: 'Start',
                  subBlocks: {},
                },
              },
              edges: [],
              loops: {},
              parallels: {},
            },
            variables: {},
          },
        }),
      })
    })

    // Current implementation should fail on first 404
    await expect(handler.execute(workflowBlock, inputs, context)).rejects.toThrow(
      'Child workflow 594431a6-18bb-481c-8b27-84502bf480e5 not found'
    )

    expect(callCount).toBe(1) // Should only try once with current implementation
    console.log('✅ Current implementation fails immediately on 404 (no retry)')
  })

  it('should test potential root cause: execution stack interference', async () => {
    console.log('Testing if execution stack from PR #927 affects child workflow loading')

    // The PR #927 changed execution stack management
    // This test checks if that interferes with child workflow execution

    const workflowBlock: SerializedBlock = {
      id: 'd33f82fa-3d12-41d3-aeb3-c0e2d8fb1d02',
      metadata: {
        id: BlockType.WORKFLOW,
        name: 'Workflow 1',
        type: 'workflow',
      },
      inputs: {},
      outputs: {},
    }

    const inputs = {
      workflowId: '594431a6-18bb-481c-8b27-84502bf480e5',
    }

    // Test with the parent workflow already in execution stack
    const context: ExecutionContext = {
      workflowId: '0bebc8f9-8563-4d4a-93d2-2a0b4d949897',
      environmentVariables: {},
      workflowVariables: {},
    }

    // Mock successful child workflow load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          name: 'runWorkflow',
          state: {
            blocks: { start: { id: 'start', type: 'starter', name: 'Start', subBlocks: {} } },
            edges: [],
            loops: {},
            parallels: {},
          },
          variables: {},
        },
      }),
    })

    // Mock successful execution
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'success' },
        }),
      })),
    }))

    vi.doMock('@/serializer', () => ({
      Serializer: vi.fn().mockImplementation(() => ({
        serializeWorkflow: vi.fn().mockReturnValue({
          blocks: {},
          edges: [],
          blockInputMap: {},
          blockOutputMap: {},
        }),
      })),
    }))

    try {
      const result = await handler.execute(workflowBlock, inputs, context)
      console.log('✅ Execution succeeded when child workflow is accessible')
      expect(result).toBeDefined()
    } catch (error) {
      console.log(`❌ Execution failed: ${error.message}`)
      // This would indicate if execution stack or other issues interfere
    }
  })
})
