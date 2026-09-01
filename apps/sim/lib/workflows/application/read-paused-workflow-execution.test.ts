/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPausedExecutionDetail: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    getPausedExecutionDetail: mocks.getPausedExecutionDetail,
  },
}))

import { readPausedWorkflowExecution } from '@/lib/workflows/application/read-paused-workflow-execution'

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
  { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  { kind: 'personal_api_key', userId: 'user-1', keyId: 'personal-key-1' },
  { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'workspace-key-1' },
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
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.getPausedExecutionDetail.mockResolvedValue(detail)
  })

  it.each(allowedPrincipals)(
    'authorizes $kind before loading paused execution detail',
    async (principal) => {
      const result = await readPausedWorkflowExecution.execute({
        principal,
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })

      expect(result).toBe(detail)
      expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({ workflowId: 'workflow-1' })
      expect(mocks.getPausedExecutionDetail).toHaveBeenCalledWith({
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

    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getPausedExecutionDetail.mock.invocationCallOrder[0]
    )
  })

  it('supports an authorization-only preflight without loading paused execution detail', async () => {
    expect(readPausedWorkflowExecution.authorize).toBeTypeOf('function')

    await readPausedWorkflowExecution.authorize?.({
      principal: allowedPrincipals[0],
      input: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })

    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({ workflowId: 'workflow-1' })
    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.getPausedExecutionDetail).not.toHaveBeenCalled()
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
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.getPausedExecutionDetail).not.toHaveBeenCalled()
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
    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.getPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('rejects a workspace key outside the canonical workspace before loading detail', async () => {
    await expect(
      readPausedWorkflowExecution.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-2',
          keyId: 'workspace-key-2',
        },
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('rejects a session without current workspace access before loading detail', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)

    await expect(
      readPausedWorkflowExecution.execute({
        principal: allowedPrincipals[0],
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ name: 'NoWorkspaceAccessError' })
    expect(mocks.getPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('enforces the workspace personal-key policy before loading detail', async () => {
    mocks.resolveWorkflowContext.mockResolvedValueOnce({
      ...workflowContext,
      allowPersonalApiKeys: false,
    })

    await expect(
      readPausedWorkflowExecution.execute({
        principal: allowedPrincipals[1],
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toMatchObject({ name: 'PersonalApiKeysDisabledError' })
    expect(mocks.getPausedExecutionDetail).not.toHaveBeenCalled()
  })

  it('returns a semantic not-found error when no paused execution matches', async () => {
    mocks.getPausedExecutionDetail.mockResolvedValueOnce(null)

    await expect(
      readPausedWorkflowExecution.execute({
        principal: allowedPrincipals[0],
        input: { workflowId: 'workflow-1', executionId: 'missing-execution' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Paused execution not found' })
  })

  it('propagates manager infrastructure failures', async () => {
    const infrastructureError = new Error('database unavailable')
    mocks.getPausedExecutionDetail.mockRejectedValueOnce(infrastructureError)

    await expect(
      readPausedWorkflowExecution.execute({
        principal: allowedPrincipals[0],
        input: { workflowId: 'workflow-1', executionId: 'execution-1' },
      })
    ).rejects.toBe(infrastructureError)
  })
})
