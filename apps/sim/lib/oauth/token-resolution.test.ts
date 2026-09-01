/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeCredentialUseForAuth,
  mockGetCredential,
  mockRecordAudit,
  mockRefreshTokenIfNeeded,
  mockResolveOAuthAccountId,
  mockResolveServiceAccountToken,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialUseForAuth: vi.fn(),
  mockGetCredential: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockRefreshTokenIfNeeded: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
  mockResolveServiceAccountToken: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_ACCESSED: 'credential.accessed' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mockAuthorizeCredentialUseForAuth,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  getCredential: mockGetCredential,
  refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  resolveServiceAccountToken: mockResolveServiceAccountToken,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { resolveCredentialToken } from '@/lib/oauth/token-resolution'

const INTERNAL_AUTH = { success: true, userId: 'user-1', authType: 'internal_jwt' } as const

describe('resolveCredentialToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveOAuthAccountId.mockResolvedValue(null)
  })

  it('fails closed when the credential is not authorized', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: false,
      error: 'You do not have access to this credential.',
    })

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'You do not have access to this credential.',
    })
    expect(mockGetCredential).not.toHaveBeenCalled()
    expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('fails closed when the caller carries no user id', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: false,
      error: 'Authentication required',
    })

    const result = await resolveCredentialToken(
      { success: true, authType: 'internal_jwt' },
      { requestId: 'req-1', credentialId: 'cred-1' }
    )

    expect(result).toEqual({ ok: false, status: 403, error: 'Authentication required' })
  })

  it('refreshes the token, records the access trail, and returns the payload', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'account-1',
    })
    mockGetCredential.mockResolvedValue({
      providerId: 'google',
      idToken: 'id-token',
      scope: 'https://www.googleapis.com/auth/gmail.send',
    })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'fresh', refreshed: true })

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
      workflowId: 'wf-1',
    })

    expect(result).toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: 'id-token' },
    })
    expect(mockGetCredential).toHaveBeenCalledWith('req-1', 'account-1', 'owner-1')
    expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        workspaceId: 'ws-1',
        resourceId: 'account-1',
        action: 'credential.accessed',
      })
    )
  })

  it('returns 404 when the authorized credential is missing', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockGetCredential.mockResolvedValue(undefined)

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Credential not found' })
  })

  it('projects the exact Dataverse environment bound in the stored scope', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'account-1',
    })
    mockGetCredential.mockResolvedValue({
      providerId: 'microsoft-dataverse',
      scope:
        'openid https://contoso.crm.dynamics.com/.default offline_access __sim_dataverse_instance__:https://contoso.crm.dynamics.com',
    })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'fresh', refreshed: false })

    await expect(
      resolveCredentialToken(INTERNAL_AUTH, {
        requestId: 'req-1',
        credentialId: 'cred-1',
      })
    ).resolves.toEqual({
      ok: true,
      token: {
        accessToken: 'fresh',
        credentialType: 'oauth',
        idToken: undefined,
        instanceUrl: 'https://contoso.api.crm.dynamics.com',
      },
    })
  })

  it('preserves a legacy Dataverse credential without projecting an environment', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'account-1',
    })
    mockGetCredential.mockResolvedValue({
      providerId: 'microsoft-dataverse',
      scope: 'https://dynamics.microsoft.com/user_impersonation',
    })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'fresh', refreshed: false })

    await expect(
      resolveCredentialToken(INTERNAL_AUTH, {
        requestId: 'req-1',
        credentialId: 'cred-1',
      })
    ).resolves.toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: undefined },
    })
    expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
  })

  it('reports a failed refresh as 401 without recording access', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockGetCredential.mockResolvedValue({ providerId: 'google' })
    mockRefreshTokenIfNeeded.mockRejectedValue(new Error('refresh token revoked'))

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'Failed to refresh access token' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('authorizes service-account credentials before minting a token', async () => {
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      credentialId: 'sa-1',
      providerId: 'google',
      workspaceId: 'ws-1',
      accountId: '',
      usedCredentialTable: true,
    })
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({ ok: false, error: 'Unauthorized' })

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Unauthorized' })
    expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })

  it('surfaces the classified service-account failure code', async () => {
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      credentialId: 'sa-1',
      providerId: 'atlassian',
      workspaceId: 'ws-1',
      accountId: '',
      usedCredentialTable: true,
    })
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({ ok: true, requesterUserId: 'user-1' })
    mockResolveServiceAccountToken.mockRejectedValue(
      new TokenServiceAccountValidationError('invalid_credentials', 401)
    )

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'invalid_credentials',
      error: 'Credential rejected by the provider — reconnect the credential',
    })
  })

  it('rejects a malformed impersonation subject before touching the credential', async () => {
    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
      impersonateEmail: 'not-an-email',
    })

    expect(result.ok).toBe(false)
    expect(mockAuthorizeCredentialUseForAuth).not.toHaveBeenCalled()
  })
})
