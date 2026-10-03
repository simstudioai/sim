import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeService: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/executor/execute-service', () => ({
  executeWorkflowService: mocks.executeService,
}))

import { PersonalApiKeysDisabledError } from '@/lib/core/application'
import { executeWorkflowOperation } from '@/lib/workflows/application/execute-workflow'

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveWorkflowContext =
  workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

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
    mockResolvePermission.mockResolvedValue('read')
    mockResolveWorkflowContext.mockResolvedValue(workflowContext)
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
      principal: createSessionPrincipal() as Principal,
      actorUserId: 'user-1',
      authenticatesCredentials: true,
    },
    {
      principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key' }) as Principal,
      actorUserId: 'user-1',
      authenticatesCredentials: true,
    },
    {
      principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key' }) as Principal,
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
      principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key' }),
      input: { ...baseInput, mode: 'async', requestedTimeoutSeconds: 600 },
    })

    expect(mocks.executeService).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitCounter: 'async', requestedTimeoutSeconds: 600 })
    )
  })

  it('rejects a personal key disabled by canonical workspace policy', async () => {
    mockResolveWorkflowContext.mockResolvedValueOnce({
      ...workflowContext,
      allowPersonalApiKeys: false,
    })

    await expect(
      executeWorkflowOperation.execute({
        principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key' }),
        input: baseInput,
      })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
    expect(mocks.executeService).not.toHaveBeenCalled()
  })
})
