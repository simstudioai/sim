/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeRequest: vi.fn(),
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/function-execution/execute-request', () => ({
  executeFunctionRequest: mocks.executeRequest,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { executeFunction } from '@/lib/function-execution/application/execute-function'

const principal: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { executionId: 'execution-1' },
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    principal: {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    },
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'deployment-1',
    },
  },
}

describe('executeFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      billedAccountUserId: 'workspace-owner',
      allowPersonalApiKeys: true,
    })
    mocks.executeRequest.mockResolvedValue(Response.json({ success: true }))
  })

  it('keeps an actorless deployed principal authoritative and attributes legacy work afterward', async () => {
    const headers = new Headers()
    const signal = new AbortController().signal
    const response = await executeFunction.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        body: {
          code: 'return 1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          workspaceId: 'workspace-1',
        },
        headers,
        signal,
      },
    })

    expect(response.status).toBe(200)
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.executeRequest).toHaveBeenCalledWith(
      { headers, signal },
      expect.objectContaining({
        code: 'return 1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      }),
      {
        attributedUserId: 'workspace-owner',
        principal,
      }
    )
  })

  it('rejects a body workspace that differs from the trusted operation scope', async () => {
    await expect(
      executeFunction.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          body: { code: 'return 1', workspaceId: 'workspace-victim' },
          headers: new Headers(),
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.executeRequest).not.toHaveBeenCalled()
  })
})
