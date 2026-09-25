import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  humanInTheLoopManagerMock,
  humanInTheLoopManagerMockFns,
} from '@sim/testing/mocks/human-in-the-loop-manager.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => humanInTheLoopManagerMock)

import { readPausedWorkflowExecution } from '@/lib/workflows/application/read-paused-workflow-execution'

const mockGetPausedExecutionDetail = humanInTheLoopManagerMockFns.mockGetPausedExecutionDetail

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveWorkflowContext =
  workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

const workflowContext = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const detail = {
  id: 'paused-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

const allowedPrincipals: Principal[] = [
  createSessionPrincipal(),
  createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
  createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
  {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'copilot-delegation-1',
    audience: 'sim:workflows',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2999-01-01T00:00:00.000Z'),
  },
]

describe('readPausedWorkflowExecution', () => {
  beforeEach(() => {
    mockResolvePermission.mockResolvedValue('read')
    mockResolveWorkflowContext.mockResolvedValue(workflowContext)
    mockGetPausedExecutionDetail.mockResolvedValue(detail)
  })

  it.each(allowedPrincipals)(
    'authorizes $kind before loading paused execution detail',
    async (principal) => {
      const result = await readPausedWorkflowExecution.execute({
        principal,
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })

      expect(result).toBe(detail)
      expect(mockResolveWorkflowContext).toHaveBeenCalledWith({ workflowId: 'workflow-1' })
      expect(mockGetPausedExecutionDetail).toHaveBeenCalledWith({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    }
  )

  it('finishes session authorization before loading paused execution detail', async () => {
    await readPausedWorkflowExecution.execute({
      principal: allowedPrincipals[0],
      input: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })

    expect(mockResolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetPausedExecutionDetail.mock.invocationCallOrder[0]
    )
  })

  it('rejects executor delegation before canonical lookup', async () => {
    const principal: Principal = {
      kind: 'delegated',
      serviceId: 'executor',
      workspaceId: 'workspace-1',
      delegationId: 'execution-delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2999-01-01T00:00:00.000Z'),
      delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
    }

    await expect(
      readPausedWorkflowExecution.execute({
        principal,
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ name: 'DelegatedServiceAuthorizationError' })
    expect(mockResolveWorkflowContext).not.toHaveBeenCalled()
    expect(mockGetPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('rejects a disallowed principal before canonical lookup', async () => {
    const principal: Principal = {
      kind: 'system',
      serviceId: 'internal',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    }

    await expect(
      readPausedWorkflowExecution.execute({
        principal,
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ name: 'PrincipalKindAuthorizationError' })
    expect(mockResolveWorkflowContext).not.toHaveBeenCalled()
    expect(mockGetPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('rejects a workspace key outside the canonical workspace before loading detail', async () => {
    await expect(
      readPausedWorkflowExecution.execute({
        principal: createWorkspaceApiKeyPrincipal({
          workspaceId: 'workspace-2',
          keyId: 'workspace-key-2',
        }),
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mockGetPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('rejects a session without current workspace access before loading detail', async () => {
    mockResolvePermission.mockResolvedValueOnce(null)

    await expect(
      readPausedWorkflowExecution.execute({
        principal: allowedPrincipals[0],
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ name: 'NoWorkspaceAccessError' })
    expect(mockGetPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('enforces the workspace personal-key policy before loading detail', async () => {
    mockResolveWorkflowContext.mockResolvedValueOnce({
      ...workflowContext,
      allowPersonalApiKeys: false,
    })

    await expect(
      readPausedWorkflowExecution.execute({
        principal: allowedPrincipals[1],
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ name: 'PersonalApiKeysDisabledError' })
    expect(mockGetPausedExecutionDetail).not.toHaveBeenCalled()
  })
})
