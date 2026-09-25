import type { DelegatedPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { credentialOperations } from '@/lib/credentials/application/operations'

vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)

import {
  requireCredentialGroupCredentialAccess,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'

const mocks = {
  loadEnrollmentAccess:
    credentialGroupsCredentialsMockFns.mockLoadCredentialGroupEnrollmentAccessForSubject,
  loadBinding: credentialGroupsCredentialsMockFns.mockLoadManagedCredentialGroupBinding,
  requirePolicy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  isAvailable: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'org-1',
  organizationId: 'org-1',
  allowPersonalApiKeys: true,
  credentialId: 'credential-1',
  credentialType: 'oauth:gmail' as const,
  credentialGroupId: 'group-1',
  credentialGroupEnrollmentId: 'enrollment-1',
}

const liveBinding = {
  credentialId: 'credential-1',
  workspaceId: 'workspace-1',
  providerId: 'google-email',
  credentialGroupId: 'group-1',
  credentialGroupOptionId: 'option-1',
  managedOauthStatus: 'active',
  enrollmentStatus: 'completed',
  groupStatus: 'active',
  optionStatus: 'active',
}

function storedPolicy(workspaceIds: string[] = ['workspace-1']) {
  return {
    id: 'policy-1',
    organizationId: 'org-1',
    revision: 1,
    document: buildOrganizationAccountAccessPolicy(
      'group-1',
      workspaceIds.map((workspaceId) => ({ workspaceId, access: { mode: 'all' as const } }))
    ),
  }
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
      workflowId: 'root-workflow',
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'root-workflow',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'version-1',
      },
    },
  }
}

function copilotPrincipal(subjectUserId: string | null = 'user-1'): DelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    ...(subjectUserId ? { subjectUserId } : {}),
    workspaceId: 'workspace-1',
    delegationId: 'copilot-tool:call-1',
    audience: 'sim:managed-oauth-credentials',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { credentialId: 'credential-1', chatId: 'chat-1' },
  }
}

function requireAccess(principal: DelegatedPrincipal, accessContext = context): Promise<void> {
  return requireCredentialGroupCredentialAccess(
    principal,
    accessContext,
    credentialOperations.useManagedOAuth.resourcePolicy
  )
}

describe('requireCredentialGroupCredentialAccess', () => {
  beforeEach(() => {
    mocks.isAvailable.mockResolvedValue(true)
    mocks.requirePolicy.mockResolvedValue(storedPolicy())
    mocks.loadEnrollmentAccess.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
    })
    mocks.loadBinding.mockResolvedValue(liveBinding)
  })

  it('denies a Chat turn once the credential group or its option is disabled', async () => {
    mocks.loadBinding.mockResolvedValue({ ...liveBinding, optionStatus: 'disabled' })
    await expect(requireAccess(copilotPrincipal())).rejects.toMatchObject({ code: 'forbidden' })

    mocks.loadBinding.mockResolvedValue({ ...liveBinding, groupStatus: 'disabled' })
    await expect(requireAccess(copilotPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('denies a workflow run the same way once the group or option is disabled', async () => {
    mocks.loadBinding.mockResolvedValue({ ...liveBinding, optionStatus: 'disabled' })
    await expect(requireAccess(executorPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
  })

  it('denies a Chat turn for a credential with no OAuth binding, which a workflow may still hold', async () => {
    mocks.loadBinding.mockResolvedValue(null)
    await expect(requireAccess(copilotPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
    await expect(requireAccess(executorPrincipal())).resolves.toBeUndefined()
  })

  it("allows a Chat turn to use only the credential under the signed-in user's own enrollment", async () => {
    await expect(requireAccess(copilotPrincipal())).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).toHaveBeenCalledWith('group-1', {
      kind: 'sim_user',
      userId: 'user-1',
    })

    await expect(
      requireAccess(copilotPrincipal(), { ...context, credentialGroupEnrollmentId: 'enrollment-2' })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('denies a Chat turn whose user holds no live enrollment, even in an allowlisted workspace', async () => {
    mocks.requirePolicy.mockResolvedValue(storedPolicy())
    mocks.loadEnrollmentAccess.mockResolvedValue(null)

    await expect(requireAccess(copilotPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('denies a Chat turn with no Sim user subject before reading anything', async () => {
    await expect(requireAccess(copilotPrincipal(null))).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })

  it('allows an external actor to use any live contributed credential in an allowed workspace', async () => {
    await expect(
      requireAccess(executorPrincipal(), {
        ...context,
        credentialGroupEnrollmentId: 'someone-else',
      })
    ).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
    expect(mocks.requirePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', resourceId: 'group-1' })
    )
  })

  it('allows a Sim actor without a personal enrollment', async () => {
    const principal = executorPrincipal()
    principal.subjectUserId = 'user-1'
    principal.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }
    mocks.loadEnrollmentAccess.mockResolvedValue(null)
    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })

  it('allows an actorless deployed workflow without a per-workflow allowlist', async () => {
    const principal = executorPrincipal()
    principal.delegationContext!.principal = {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'root-workflow',
    }
    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
    mocks.requirePolicy.mockResolvedValue(storedPolicy([]))
    await expect(requireAccess(principal)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('denies a child workflow in a different or non-allowlisted workspace', async () => {
    const principal = executorPrincipal()
    principal.delegationContext!.currentWorkflow = {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'child-version',
    }
    await expect(
      requireAccess(principal, { ...context, workspaceId: 'child-workspace' })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      requireAccess(principal, { ...context, workspaceOrganizationId: 'other-org' })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('rejects workspace-owned legacy workflow credentials with a reconnect instruction', async () => {
    await expect(
      requireAccess(executorPrincipal(), { ...context, organizationId: undefined })
    ).rejects.toThrow('Reconnect this account')
  })

  it.each([executorPrincipal, copilotPrincipal])(
    'rechecks the canonical integration even when the workspace still has other grants',
    async (makePrincipal) => {
      await expect(requireAccess(makePrincipal())).resolves.toBeUndefined()
      mocks.requirePolicy.mockResolvedValue({
        document: buildOrganizationAccountAccessPolicy('group-1', [
          {
            workspaceId: 'workspace-1',
            access: { mode: 'selected', credentialTypes: ['oauth:google-calendar'] },
          },
        ]),
      })
      await expect(requireAccess(makePrincipal())).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.requirePolicy).toHaveBeenCalledTimes(2)
    }
  )

  it('rechecks the org feature flag before credential use', async () => {
    mocks.isAvailable.mockResolvedValue(false)
    await expect(requireAccess(executorPrincipal())).rejects.toMatchObject({ code: 'not_found' })
  })

  it('requires a live connector grant to execute a managed MCP credential', async () => {
    mocks.loadBinding.mockResolvedValue(null)
    const managedContext = { ...context, credentialType: 'mcp:fireflies' as const }
    const principal = executorPrincipal()
    const requireManagedAccess = () =>
      requireCredentialGroupCredentialAccess(
        principal,
        managedContext,
        credentialOperations.useManagedMcp.resourcePolicy
      )

    await expect(requireManagedAccess()).resolves.toBeUndefined()

    mocks.requirePolicy.mockResolvedValue(storedPolicy([]))
    await expect(requireManagedAccess()).rejects.toMatchObject({ code: 'forbidden' })

    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        {
          workspaceId: context.workspaceId,
          access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
        },
      ]),
    })
    await expect(requireManagedAccess()).rejects.toMatchObject({ code: 'forbidden' })

    mocks.requirePolicy.mockResolvedValue(storedPolicy())
    mocks.isAvailable.mockResolvedValue(false)
    await expect(requireManagedAccess()).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects inconsistent Sim and external subject assertions before loading policy', async () => {
    const simPrincipal = executorPrincipal()
    simPrincipal.subjectUserId = 'user-2'
    simPrincipal.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }
    await expect(requireAccess(simPrincipal)).rejects.toMatchObject({ code: 'forbidden' })

    const externalPrincipal = executorPrincipal()
    externalPrincipal.subjectUserId = 'invented-user'
    await expect(requireAccess(externalPrincipal)).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
  })

  it('requires the original principal and current workflow before loading policy', async () => {
    const missingPrincipal = executorPrincipal()
    missingPrincipal.delegationContext!.principal = undefined
    await expect(requireAccess(missingPrincipal)).rejects.toThrow('missing its workflow principal')

    const missingCurrentWorkflow = executorPrincipal()
    missingCurrentWorkflow.delegationContext!.currentWorkflow = undefined
    await expect(requireAccess(missingCurrentWorkflow)).rejects.toThrow(
      'missing its current workflow authority'
    )
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
  })

  it('loads and validates the required policy before resolving actor enrollment', async () => {
    mocks.requirePolicy.mockRejectedValue(new Error('Malformed resource policy'))

    await expect(requireAccess(executorPrincipal())).rejects.toThrow('Malformed resource policy')
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })
})

describe('requireCredentialGroupWorkflowActor', () => {
  it('returns the external subject a Slack-triggered run acts as', () => {
    expect(requireCredentialGroupWorkflowActor(executorPrincipal())).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T123',
      subjectId: 'U123',
    })
  })

  it('returns no subject for an actorless deployed run', () => {
    const principal = executorPrincipal()
    principal.delegationContext!.principal = {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'root-workflow',
    }

    expect(requireCredentialGroupWorkflowActor(principal)).toBeNull()
  })

  it('returns the Sim subject a session-actor run acts as', () => {
    const principal = executorPrincipal()
    principal.subjectUserId = 'user-1'
    principal.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    expect(requireCredentialGroupWorkflowActor(principal)).toEqual({
      kind: 'sim_user',
      userId: 'user-1',
    })
  })

  it('rejects a delegation whose asserted subject contradicts its run', () => {
    const invented = executorPrincipal()
    invented.subjectUserId = 'invented-user'
    expect(() => requireCredentialGroupWorkflowActor(invented)).toThrow(
      'Credential Group actor access required'
    )

    const mismatched = executorPrincipal()
    mismatched.subjectUserId = 'user-2'
    mismatched.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }
    expect(() => requireCredentialGroupWorkflowActor(mismatched)).toThrow(
      'Credential Group actor access required'
    )
  })
})
