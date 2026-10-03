import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  executeRequest: vi.fn(),
}))

vi.mock('@/lib/function-execution/execute-request', () => ({
  executeFunctionRequest: hoisted.executeRequest,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { executeFunction } from '@/lib/function-execution/application/execute-function'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = {
  ...hoisted,
  loadWorkspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

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
    const humanPrincipal: WorkflowExecutionDelegatedPrincipal = {
      ...principal,
      subjectUserId: 'invoking-user',
      delegationContext: {
        ...principal.delegationContext!,
        principal: {
          kind: 'session',
          userId: 'invoking-user',
          sessionId: 'session-1',
        },
      },
    }

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

  it('passes trusted registry state outside the parsed Function wire body', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'workspace-owner',
      workspaceId: 'workspace-1',
    })
    await executeFunction.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        body: {
          code: 'return 1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
        headers: new Headers(),
        resolvedSecretTraceRegistry: registry,
      },
    })

    expect(mocks.executeRequest.mock.calls[0][2].resolvedSecretTraceRegistry).toBe(registry)
    expect(mocks.executeRequest.mock.calls[0][1]).not.toHaveProperty('resolvedSecretTraceRegistry')
  })
})
