/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findPolicyGrant: vi.fn(),
  loadEnrollmentAccess: vi.fn(),
}))

vi.mock('@/lib/credential-groups/credentials', () => ({
  loadCredentialGroupEnrollmentAccessForSubject: mocks.loadEnrollmentAccess,
}))

vi.mock('@/lib/resource-policies/authorization', () => ({
  findResourcePolicyGrant: mocks.findPolicyGrant,
}))

import { requireCredentialGroupCredentialAccess } from '@/lib/credential-groups/application/authorization'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  credentialGroupId: 'group-1',
}

function executorPrincipal(): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:managed-oauth-credentials',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      },
    },
  }
}

describe('requireCredentialGroupCredentialAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findPolicyGrant.mockResolvedValue(null)
    mocks.loadEnrollmentAccess.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
    })
  })

  it('resolves an external workflow actor to their enrollment', async () => {
    const principal = executorPrincipal()

    await expect(
      requireCredentialGroupCredentialAccess(
        principal,
        context,
        'credential_groups.credentials.use'
      )
    ).resolves.toEqual({
      scope: 'enrollment',
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
    })
    expect(mocks.loadEnrollmentAccess).toHaveBeenCalledWith('group-1', {
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T123',
      subjectId: 'U123',
    })
  })

  it('rejects an actorless workflow principal', async () => {
    const principal = executorPrincipal()
    principal.delegationContext!.principal = {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    }

    await expect(
      requireCredentialGroupCredentialAccess(
        principal,
        context,
        'credential_groups.credentials.use'
      )
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Credential Group actor access required',
    })
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })

  it('rejects an executor delegation whose Sim subject does not match the workflow actor', async () => {
    const principal = executorPrincipal()
    principal.subjectUserId = 'user-2'
    principal.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await expect(
      requireCredentialGroupCredentialAccess(
        principal,
        context,
        'credential_groups.credentials.use'
      )
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })

  it('allows an actorless workflow when an explicit policy grant matches', async () => {
    const principal = executorPrincipal()
    principal.delegationContext!.principal = {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    }
    mocks.findPolicyGrant.mockResolvedValue({ id: 'grant-1' })

    await expect(
      requireCredentialGroupCredentialAccess(
        principal,
        context,
        'credential_groups.credentials.use'
      )
    ).resolves.toEqual({ scope: 'all', grantId: 'grant-1' })
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })
})
