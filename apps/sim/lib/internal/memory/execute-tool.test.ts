/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import type { ExecutionContext } from '@/executor/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  requireWorkspaceId: vi.fn(() => 'workspace-canonical'),
  add: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  createResponse: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
  requireExecutorWorkspaceId: mocks.requireWorkspaceId,
}))

vi.mock('@/lib/internal/memory/operations', () => ({
  executeMemoryAdd: mocks.add,
  executeMemoryList: mocks.list,
  executeMemoryGet: mocks.get,
  executeMemoryDelete: mocks.remove,
}))

vi.mock('@/lib/internal/memory/provenance', () => ({
  MemoryProvenanceError: class MemoryProvenanceError extends Error {},
  createMemoryToolResponse: mocks.createResponse,
}))

import { executeMemoryTool } from '@/lib/internal/memory/execute-tool'

const PRINCIPAL = createTestRuntimePrincipal()

const ACTORLESS_DEPLOYED_PRINCIPAL = createTestRuntimePrincipal({
  principal: {
    kind: 'system',
    serviceId: 'schedule',
    workspaceId: 'workspace-canonical',
    workflowId: 'workflow-1',
  },
  currentWorkflow: {
    workflowId: 'workflow-1',
    mode: 'deployment',
    deploymentVersionId: 'deployment-1',
  },
})

const CONTEXT = { userId: 'user-1', workflowId: 'workflow-1' } as ExecutionContext

const MEMORY = {
  conversationId: 'conversation-1',
  data: [{ role: 'user', content: 'hello' }],
}

const CASES = [
  {
    toolId: 'memory_add',
    input: {
      key: 'conversation-1',
      data: { role: 'user', content: 'hello' },
    },
    operation: 'add' as const,
  },
  {
    toolId: 'memory_get_all',
    input: {},
    operation: 'list' as const,
  },
  {
    toolId: 'memory_get',
    input: { id: 'conversation-1' },
    operation: 'get' as const,
  },
  {
    toolId: 'memory_delete',
    input: { conversationId: 'conversation-1' },
    operation: 'remove' as const,
  },
]

describe('executeMemoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.add.mockResolvedValue({ body: { success: true, data: MEMORY } })
    mocks.list.mockResolvedValue({
      body: { success: true, data: { memories: [MEMORY] } },
    })
    mocks.get.mockResolvedValue({ body: { success: true, data: MEMORY } })
    mocks.remove.mockResolvedValue({
      body: {
        success: true,
        data: { message: 'Successfully deleted 1 memories', deletedCount: 1 },
      },
    })
    mocks.createResponse.mockImplementation(async (body) => Response.json(body))
  })

  it.each(CASES)('dispatches $toolId through its canonical contract', async (testCase) => {
    const response = await executeMemoryTool({
      toolId: testCase.toolId,
      input: testCase.input,
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mocks[testCase.operation]).toHaveBeenCalledOnce()
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
    })
  })

  it('authenticates before validating operation input', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new Error('Authentication required'))
    const response = await executeMemoryTool({
      toolId: 'memory_add',
      input: null,
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'Authentication required' },
    })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('preserves actorless deployed authority and uses only post-authorization provenance scope', async () => {
    const provenanceScope = {
      userId: 'billing-owner',
      workspaceId: 'workspace-canonical',
    }
    const actorlessContext = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-canonical',
      executionId: 'execution-1',
      principal: ACTORLESS_DEPLOYED_PRINCIPAL,
    }
    mocks.createPrincipal.mockResolvedValueOnce(ACTORLESS_DEPLOYED_PRINCIPAL)
    mocks.list.mockResolvedValueOnce({
      body: { success: true, data: { memories: [MEMORY] } },
      provenance: [],
      provenanceScope,
    })

    const response = await executeMemoryTool({
      toolId: 'memory_get_all',
      input: {},
      headers: new Headers(),
      context: actorlessContext,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ principal: ACTORLESS_DEPLOYED_PRINCIPAL })
    )
    expect(mocks.createResponse).toHaveBeenCalledWith(expect.any(Object), [], provenanceScope)
  })

  it('rejects invalid input and invalid operation responses', async () => {
    const invalidInput = await executeMemoryTool({
      toolId: 'memory_get',
      input: {},
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(invalidInput.status).toBe(400)
    expect(await invalidInput.json()).toMatchObject({ error: 'Validation error' })

    mocks.get.mockResolvedValueOnce({ body: { success: true, data: { conversationId: 42 } } })
    const invalidResponse = await executeMemoryTool({
      toolId: 'memory_get',
      input: { id: 'conversation-1' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(invalidResponse.status).toBe(500)
    expect(await invalidResponse.json()).toEqual({
      success: false,
      error: { message: 'Failed to retrieve memory' },
    })
  })
})
