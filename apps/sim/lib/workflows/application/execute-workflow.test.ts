/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeService: vi.fn(),
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

vi.mock('@/lib/workflows/executor/execute-service', () => ({
  executeWorkflowService: mocks.executeService,
}))

import { PersonalApiKeysDisabledError } from '@/lib/core/application'
import { executeWorkflowOperation } from '@/lib/workflows/application/execute-workflow'

const workflow = { id: 'workflow-1', userId: 'owner-1', workspaceId: 'workspace-1' }
const workflowContext = {
  workflowId: 'workflow-1',
  workflow,
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const baseInput = {
  workflowId: 'workflow-1',
  requestId: 'request-1',
  input: { hello: 'world' },
  mode: 'sync' as const,
  requestHeaders: new Headers(),
}

describe('executeWorkflowOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.executeService.mockResolvedValue({
      ok: true,
      executionId: 'run-1',
      workflowId: 'workflow-1',
      status: 'completed',
      aborted: null,
      output: {},
      error: null,
      hasResponseBlock: false,
    })
  })

  it.each([
    {
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as Principal,
      actorUserId: 'user-1',
      authenticatesCredentials: true,
    },
    {
      principal: {
        kind: 'personal_api_key',
        userId: 'user-1',
        keyId: 'personal-key',
      } as Principal,
      actorUserId: 'user-1',
      authenticatesCredentials: true,
    },
    {
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key',
      } as Principal,
      actorUserId: 'billing-owner-1',
      authenticatesCredentials: false,
    },
    {
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2999-01-01T00:00:00Z'),
      } as Principal,
      actorUserId: 'user-1',
      authenticatesCredentials: true,
    },
  ])(
    'derives execution actor and credential policy from $principal.kind',
    async ({ principal, actorUserId, authenticatesCredentials }) => {
      await executeWorkflowOperation.execute({ principal, input: baseInput })

      expect(mocks.executeService).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'workflow-1',
          principal,
          userId: actorUserId,
          workflowRecord: workflow,
          triggerType: 'api',
          rateLimitCounter: 'sync',
          useAuthenticatedUserAsActor: authenticatesCredentials,
        })
      )
    }
  )

  it('uses the async execution quota bucket without performing request-rate limiting', async () => {
    await executeWorkflowOperation.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key',
      },
      input: { ...baseInput, mode: 'async', requestedTimeoutSeconds: 600 },
    })

    expect(mocks.executeService).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitCounter: 'async', requestedTimeoutSeconds: 600 })
    )
  })

  it('rejects a personal key disabled by canonical workspace policy', async () => {
    mocks.resolveWorkflowContext.mockResolvedValueOnce({
      ...workflowContext,
      allowPersonalApiKeys: false,
    })

    await expect(
      executeWorkflowOperation.execute({
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'personal-key' },
        input: baseInput,
      })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
    expect(mocks.executeService).not.toHaveBeenCalled()
  })

  it('passes through execution infrastructure failures', async () => {
    const infrastructureError = new Error('queue unavailable')
    mocks.executeService.mockRejectedValueOnce(infrastructureError)

    await expect(
      executeWorkflowOperation.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'workspace-key',
        },
        input: baseInput,
      })
    ).rejects.toBe(infrastructureError)
  })
})
