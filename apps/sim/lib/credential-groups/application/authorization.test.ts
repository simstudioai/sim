/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import { requireCredentialGroupCredentialAccess } from '@/lib/credential-groups/application/authorization'

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

function requireAccess(
  principal: WorkflowExecutionDelegatedPrincipal,
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

  it('allows an external actor to use only their own enrollment', async () => {
    const principal = executorPrincipal()

    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.requirePolicy).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      resourceType: 'credential_group',
      resourceId: 'group-1',
      codec: expect.objectContaining({ resourceType: 'credential_group' }),
    })
    expect(mocks.loadEnrollmentAccess).toHaveBeenCalledWith('group-1', {
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T123',
      subjectId: 'U123',
    })

    await expect(
      requireAccess(principal, {
        ...context,
        credentialGroupEnrollmentId: 'enrollment-2',
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('allows a Sim actor to use their own enrollment', async () => {
    const principal = executorPrincipal()
    principal.subjectUserId = 'user-1'
    principal.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).toHaveBeenCalledWith('group-1', {
      kind: 'sim_user',
      userId: 'user-1',
    })
  })

  it('allows an actorless deployed workflow only when its current workflow is allowlisted', async () => {
    const principal = executorPrincipal()
    principal.delegationContext!.principal = {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'root-workflow',
    }
    mocks.requirePolicy.mockResolvedValue(storedPolicy(['workflow-1']))

    await expect(requireAccess(principal)).resolves.toBeUndefined()
    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()

    principal.delegationContext!.currentWorkflow = { workflowId: 'workflow-1', mode: 'draft' }
    await expect(requireAccess(principal)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('uses the current child workflow rather than the root workflow grant', async () => {
    const principal = executorPrincipal()
    principal.delegationContext!.principal = {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'root-workflow',
    }
    principal.delegationContext!.currentWorkflow = {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'child-version',
    }
    mocks.requirePolicy.mockResolvedValue(storedPolicy(['root-workflow']))

    await expect(requireAccess(principal)).rejects.toMatchObject({
      code: 'forbidden',
    })
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
