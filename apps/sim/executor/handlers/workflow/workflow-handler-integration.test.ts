import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { WorkflowBlockHandler } from './workflow-handler'

// Mock the external dependencies
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn(() => Promise.resolve('mock-token')),
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

// Mock the serializer
vi.mock('@/serializer', () => ({
  Serializer: vi.fn().mockImplementation(() => ({
    serializeWorkflow: vi.fn().mockReturnValue({
      blocks: {},
      edges: [],
      blockInputMap: {},
      blockOutputMap: {},
    }),
  })),
}))

// Mock the executor
const mockExecutorResult = {
  success: true,
  output: { test: 'result' },
  metadata: { duration: 1000 },
}

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(mockExecutorResult),
  })),
}))

describe('WorkflowBlockHandler Integration Test - Child Workflow Not Found', () => {
  let handler: WorkflowBlockHandler
  let mockFetch: any

  beforeEach(() => {
    handler = new WorkflowBlockHandler()

    // Mock global fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch

    // Mock performance for timing
    global.performance = {
      now: vi.fn(() => Date.now()),
    } as any
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should reproduce the "Child workflow not found" error from real data', async () => {
    // This is the actual workflow block from the failing parent workflow
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

    // This represents the subblock values that would reference the child workflow
    const inputs = {
      workflowId: '594431a6-18bb-481c-8b27-84502bf480e5', // The child workflow that "doesn't exist"
      input: undefined,
    }

    const context: ExecutionContext = {
      workflowId: '0bebc8f9-8563-4d4a-93d2-2a0b4d949897', // Parent workflow ID
      environmentVariables: {},
      workflowVariables: {},
    }

    // Test case 1: Simulate 404 response (child workflow not found)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: vi.fn().mockResolvedValue({ error: 'Workflow not found' }),
    })

    // Should throw the exact error we're seeing
    await expect(handler.execute(workflowBlock, inputs, context)).rejects.toThrow(
      'Child workflow 594431a6-18bb-481c-8b27-84502bf480e5 not found'
    )

    // Verify the fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/workflows/594431a6-18bb-481c-8b27-84502bf480e5',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
      }
    )
  })

  it('should reproduce the error with 403 response (access denied)', async () => {
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

    // Test case 2: Simulate 403 response (access denied - possible cross-workspace issue)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: vi.fn().mockResolvedValue({ error: 'Access denied' }),
    })

    // Should still throw "not found" error but log access issue
    await expect(handler.execute(workflowBlock, inputs, context)).rejects.toThrow(
      'Error in child workflow "runWorkflow": Child workflow 594431a6-18bb-481c-8b27-84502bf480e5 exists but could not be loaded. This may be due to workspace access restrictions or the workflow may be in a different workspace.'
    )
  })

  it('should succeed when child workflow exists and is accessible', async () => {
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
      input: { test: 'input' },
    }

    const context: ExecutionContext = {
      workflowId: '0bebc8f9-8563-4d4a-93d2-2a0b4d949897',
      environmentVariables: {},
      workflowVariables: {},
    }

    // Mock successful workflow fetch
    const mockWorkflowResponse = {
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
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockWorkflowResponse),
    })

    const result = await handler.execute(workflowBlock, inputs, context)

    expect(result).toEqual({
      success: true,
      childWorkflowName: 'runWorkflow',
      result: mockExecutorResult,
    })
  })

  it('should handle network errors gracefully', async () => {
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

    const context: ExecutionContext = {
      workflowId: '0bebc8f9-8563-4d4a-93d2-2a0b4d949897',
      environmentVariables: {},
      workflowVariables: {},
    }

    // Simulate network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(handler.execute(workflowBlock, inputs, context)).rejects.toThrow(
      'Error in child workflow "runWorkflow": Child workflow 594431a6-18bb-481c-8b27-84502bf480e5 not found'
    )
  })
})
