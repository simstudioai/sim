/**
 * @vitest-environment node
 */
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

import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { executeFunction } from '@/lib/function-execution/application/execute-function'

const principal = createTestRuntimePrincipal({
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
})

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
    mocks.resolvePermission.mockResolvedValue('write')
  })

  it('uses only the real workflow subject for legacy file contexts', async () => {
    const humanPrincipal = createTestRuntimePrincipal({
      principal: {
        kind: 'session',
        userId: 'invoking-user',
        sessionId: 'session-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    })

    await executeFunction.execute({
      principal: humanPrincipal,
      input: {
        workspaceId: 'workspace-1',
        body: {
          code: 'return 1',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
        },
        headers: new Headers(),
      },
    })

    expect(mocks.executeRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        attributedUserId: 'invoking-user',
        fileAccessUserId: 'invoking-user',
        principal: humanPrincipal,
      })
    )
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
