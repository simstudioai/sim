/**
 * @vitest-environment node
 */

import type {
  BoundWorkflowExecutionPrincipal,
  DelegatedPrincipal,
  Principal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import {
  requireCredentialGroupCredentialAccess,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { credentialOperations } from '@/lib/credentials/application/operations'

const mocks = vi.hoisted(() => ({
  loadEnrollmentAccess: vi.fn(),
  loadBinding: vi.fn(),
  requirePolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/credentials', () => ({
  loadCredentialGroupEnrollmentAccessForSubject: mocks.loadEnrollmentAccess,
  loadManagedCredentialGroupBinding: mocks.loadBinding,
  isManagedCredentialGroupBindingLive: (binding: {
    managedOauthStatus: string
    enrollmentStatus: string
    groupStatus: string
    optionStatus: string | null
  }) =>
    binding.managedOauthStatus === 'active' &&
    ['in_progress', 'completed'].includes(binding.enrollmentStatus) &&
    binding.groupStatus === 'active' &&
    binding.optionStatus === 'active',
}))

vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.requirePolicy,
}))

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  credentialId: 'credential-1',
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

function storedPolicy(allowedWorkflowIds: string[] = []) {
  return {
    id: 'policy-1',
    workspaceId: 'workspace-1',
    revision: 1,
    document: compileCredentialGroupWorkflowAccessPolicy({
      credentialGroupId: 'group-1',
      allowedWorkflowIds,
    }),
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
  }
}

function slackPrincipal(): BoundWorkflowExecutionPrincipal {
  return createTestRuntimePrincipal({
    rootWorkflowId: 'root-workflow',
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'version-1',
    },
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
  })
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
  } as DelegatedPrincipal
}

function workflowPrincipal(): BoundWorkflowExecutionPrincipal {
  return createTestRuntimePrincipal()
}

function requireAccess(principal: Principal, accessContext = context): Promise<void> {
  return requireCredentialGroupCredentialAccess(
    principal,
    accessContext,
    credentialOperations.useManagedOAuth.resourcePolicy
  )
}

describe('requireCredentialGroupCredentialAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    await expect(requireAccess(workflowPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
  })

  it('denies a Chat turn for a credential with no OAuth binding, which a workflow may still hold', async () => {
    mocks.loadBinding.mockResolvedValue(null)
    await expect(requireAccess(copilotPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
    await expect(requireAccess(workflowPrincipal())).resolves.toBeUndefined()
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

  it('denies a Chat turn whose user holds no live enrollment, even for an allowlisted workflow', async () => {
    mocks.requirePolicy.mockResolvedValue(storedPolicy(['workflow-1']))
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

  it('allows an external actor to use only its own enrollment', async () => {
    const principal = slackPrincipal()

    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).toHaveBeenCalledWith('group-1', {
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T123',
      subjectId: 'U123',
    })
    await expect(
      requireAccess(principal, { ...context, credentialGroupEnrollmentId: 'enrollment-2' })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('allows a Sim actor to use its own enrollment', async () => {
    const principal = createTestRuntimePrincipal({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'version-1',
      },
    })

    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).toHaveBeenCalledWith('group-1', {
      kind: 'sim_user',
      userId: 'user-1',
    })
  })

  it('allows an actorless deployment only when its current workflow is allowlisted', async () => {
    const principal = createTestRuntimePrincipal({
      rootWorkflowId: 'root-workflow',
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'root-workflow',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'version-1',
      },
    })
    mocks.requirePolicy.mockResolvedValue(storedPolicy(['workflow-1']))

    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })

  it('uses the current child rather than the root workflow grant', async () => {
    const principal = createTestRuntimePrincipal({
      rootWorkflowId: 'root-workflow',
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'root-workflow',
      },
      currentWorkflow: {
        workflowId: 'child-workflow',
        mode: 'deployment',
        deploymentVersionId: 'child-version',
      },
    })
    mocks.requirePolicy.mockResolvedValue(storedPolicy(['root-workflow']))

    await expect(requireAccess(principal)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('fails fast without execution metadata before loading policy', async () => {
    await expect(
      requireCredentialGroupCredentialAccess(
        { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        context,
        credentialOperations.useManagedOAuth.resourcePolicy
      )
    ).rejects.toThrow('missing execution metadata')
    expect(mocks.requirePolicy).not.toHaveBeenCalled()
  })

  it('loads and validates the required policy before resolving actor enrollment', async () => {
    mocks.requirePolicy.mockRejectedValue(new Error('Malformed resource policy'))

    await expect(requireAccess(slackPrincipal())).rejects.toThrow('Malformed resource policy')
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
  })
})

describe('requireCredentialGroupWorkflowActor', () => {
  it('returns the verified Slack subject unchanged', () => {
    expect(requireCredentialGroupWorkflowActor(slackPrincipal())).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T123',
      subjectId: 'U123',
    })
  })

  it('returns no subject for an actorless deployed run', () => {
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
        deploymentVersionId: 'version-1',
      },
    })

    expect(requireCredentialGroupWorkflowActor(principal)).toBeNull()
  })

  it('returns the Sim subject for a session-actor run', () => {
    const principal = createTestRuntimePrincipal()

    expect(requireCredentialGroupWorkflowActor(principal)).toEqual({
      kind: 'sim_user',
      userId: 'user-1',
    })
  })
})
