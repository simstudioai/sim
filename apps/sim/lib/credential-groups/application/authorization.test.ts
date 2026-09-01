/**
 * @vitest-environment node
 */

import type { BoundWorkflowExecutionPrincipal } from '@sim/auth/principal'
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
  requirePolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/credentials', () => ({
  loadCredentialGroupEnrollmentAccessForSubject: mocks.loadEnrollmentAccess,
}))

vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.requirePolicy,
}))

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  credentialGroupId: 'group-1',
  credentialGroupEnrollmentId: 'enrollment-1',
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

function requireAccess(
  principal: BoundWorkflowExecutionPrincipal,
  accessContext = context
): Promise<void> {
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
