import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  read: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/memory/conversation-store', () => ({ readConversationItems: hoisted.read }))
vi.mock('@/lib/memory/retrieval-prefix', () => ({
  readMemoryRetrievalPrefix: async () => ({ status: 'missing' }),
}))

import { retrieveAgentMemoryUseCase } from '@/lib/memory/application/retrieval'

const mocks = {
  ...hoisted,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const input = {
  workspaceId: 'workspace-1',
  memoryId: 'memory-original',
  arguments: { target: 'history' as const },
  projection: {},
}
function principal(): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:memory',
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60000),
    subjectUserId: 'user-1',
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: createSessionPrincipal(),
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    },
  }
}

describe('Agent memory retrieval authorization', () => {
  beforeEach(() => {
    mocks.workspace.mockResolvedValue({
      workspaceId: input.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-user',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.read.mockResolvedValue({ items: [] })
  })

  it('reauthorizes the current human subject before every protected read', async () => {
    await retrieveAgentMemoryUseCase.execute({ principal: principal(), input })
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.read.mock.invocationCallOrder[0]
    )
    mocks.permission.mockResolvedValue(null)
    await expect(
      retrieveAgentMemoryUseCase.execute({ principal: principal(), input })
    ).rejects.toThrow()
    expect(mocks.read).toHaveBeenCalledOnce()
  })

  it('rejects unsupported principal kinds before canonical loading', async () => {
    await expect(
      retrieveAgentMemoryUseCase.execute({
        principal: createSessionPrincipal(),
        input,
      })
    ).rejects.toThrow()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects expired, foreign-workspace and wrong-audience delegations without reading history', async () => {
    for (const actor of [
      { ...principal(), expiresAt: new Date(0) },
      { ...principal(), workspaceId: 'other-workspace' },
      { ...principal(), audience: 'sim:other' },
    ])
      await expect(
        retrieveAgentMemoryUseCase.execute({ principal: actor, input })
      ).rejects.toThrow()
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
