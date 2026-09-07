/**
 * @vitest-environment node
 */
import {
  type BoundWorkflowExecutionPrincipal,
  bindPrincipalExecutionMetadata,
  type SessionPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  requireCredentialAccess: vi.fn(),
  resolvePermission: vi.fn(),
  resolveToken: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/credentials/managed-oauth', () => ({
  loadManagedOAuthCredentialApplicationContext: mocks.loadContext,
  resolveManagedOAuthToken: mocks.resolveToken,
}))

vi.mock('@/lib/credential-groups/application/authorization', () => ({
  requireCredentialGroupCredentialAccess: mocks.requireCredentialAccess,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_ACCESSED: 'credential.accessed' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mocks.recordAudit,
}))

import { resolveManagedOAuthCredentialToken } from '@/lib/credentials/application/resolve-managed-oauth-token'

const context = {
  credentialId: 'credential-1',
  credentialGroupId: 'group-1',
  credentialGroupEnrollmentId: 'enrollment-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
}

const input = {
  credentialId: 'credential-1',
  expectedProviderId: 'google-email',
  requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  toolId: 'gmail_read',
}

function executorPrincipal(): BoundWorkflowExecutionPrincipal {
  return bindPrincipalExecutionMetadata(
    { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    {
      executionId: 'execution-1',
      rootWorkflowId: 'workflow-1',
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'version-1',
      },
    }
  )
}

describe('resolveManagedOAuthCredentialToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.requireCredentialAccess.mockResolvedValue(undefined)
    mocks.resolveToken.mockResolvedValue({ accessToken: 'access-token', refreshed: false })
  })

  it('rejects unsupported principals before loading the credential', async () => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await expect(
      resolveManagedOAuthCredentialToken.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadContext).not.toHaveBeenCalled()
  })

  it('does not treat an unbound session as workflow execution authority', async () => {
    await expect(
      resolveManagedOAuthCredentialToken.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })

  it('resolves the token only after current workspace authorization', async () => {
    const principal = executorPrincipal()
    const result = await resolveManagedOAuthCredentialToken.execute({
      principal,
      input,
    })

    expect(mocks.resolvePermission).toHaveBeenCalledWith('user-1', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.requireCredentialAccess).toHaveBeenCalledWith(principal, context, {
      resourceType: 'credential_group',
      action: 'credential_groups.credentials.use',
    })
    expect(mocks.resolveToken).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      workspaceId: 'workspace-1',
      expectedProviderId: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    })
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshed: false,
      workspaceId: 'workspace-1',
    })
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })

  it('does not resolve token material when the resource policy denies access', async () => {
    mocks.requireCredentialAccess.mockRejectedValueOnce({
      code: 'forbidden',
      message: 'Credential Group credential access denied',
    })

    await expect(
      resolveManagedOAuthCredentialToken.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Credential Group credential access denied',
    })
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })

  it('allows token resolution after any policy allow, including workflow-wide access', async () => {
    mocks.requireCredentialAccess.mockResolvedValueOnce(undefined)

    await expect(
      resolveManagedOAuthCredentialToken.execute({ principal: executorPrincipal(), input })
    ).resolves.toEqual({
      accessToken: 'access-token',
      refreshed: false,
      workspaceId: 'workspace-1',
    })
    expect(mocks.resolveToken).toHaveBeenCalledOnce()
  })
})
