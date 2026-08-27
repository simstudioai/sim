/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  resolvePermission: vi.fn(),
  resolveToken: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/credentials/managed-oauth', () => ({
  loadManagedOAuthCredentialApplicationContext: mocks.loadContext,
  resolveManagedOAuthToken: mocks.resolveToken,
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

function executorPrincipal(credentialId = 'credential-1'): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:managed-oauth-credentials',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { credentialId },
    delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
  }
}

describe('resolveManagedOAuthCredentialToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
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

  it('rejects a delegation scoped to another credential', async () => {
    await expect(
      resolveManagedOAuthCredentialToken.execute({
        principal: executorPrincipal('credential-2'),
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })

  it('resolves the token only after current workspace authorization', async () => {
    const result = await resolveManagedOAuthCredentialToken.execute({
      principal: executorPrincipal(),
      input,
    })

    expect(mocks.resolvePermission).toHaveBeenCalledWith('user-1', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.resolveToken).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      workspaceId: 'workspace-1',
      expectedProviderId: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    })
    expect(result).toEqual({ accessToken: 'access-token', refreshed: false })
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })
})
