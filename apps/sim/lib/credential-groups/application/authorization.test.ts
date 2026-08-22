/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadEnrollmentAccess: vi.fn(),
}))

vi.mock('@/lib/credential-groups/credentials', () => ({
  loadCredentialGroupEnrollmentAccessForSubject: mocks.loadEnrollmentAccess,
}))

import { requireCredentialGroupEnrollmentAccess } from '@/lib/credential-groups/application/authorization'

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

describe('requireCredentialGroupEnrollmentAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadEnrollmentAccess.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
    })
  })

  it('resolves an external workflow actor to their enrollment', async () => {
    const principal = executorPrincipal()

    await expect(requireCredentialGroupEnrollmentAccess(principal, 'group-1')).resolves.toEqual({
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
      requireCredentialGroupEnrollmentAccess(principal, 'group-1')
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Credential Group enrollment access required',
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
      requireCredentialGroupEnrollmentAccess(principal, 'group-1')
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })
})
