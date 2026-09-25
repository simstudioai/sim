import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  add: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  createResponse: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
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

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:memory',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

const ACTORLESS_DEPLOYED_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-actorless',
  audience: 'sim:memory',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
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
  },
}

const MEMORY = {
  conversationId: 'conversation-1',
  data: [{ role: 'user', content: 'hello' }],
}

describe('executeMemoryTool', () => {
  beforeEach(() => {
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

  it('preserves actorless deployed authority and uses only post-authorization provenance scope', async () => {
    const provenanceScope = {
      userId: 'billing-owner',
      workspaceId: 'workspace-canonical',
    }
    const actorlessContext = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-canonical',
      executionId: 'execution-1',
      executorDelegationOrigin: {
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        principal: ACTORLESS_DEPLOYED_PRINCIPAL.delegationContext?.principal,
        currentWorkflow: ACTORLESS_DEPLOYED_PRINCIPAL.delegationContext?.currentWorkflow,
      },
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
})
