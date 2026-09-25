import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeCredentialUseForAuth,
  mockCaptureServerEvent,
  mockExecuteManagedToken,
  mockGetCredential,
  mockGetToolMetadata,
  mockRecordAudit,
  mockRefreshTokenIfNeeded,
  mockResolveOAuthAccountId,
  mockResolveServiceAccountToken,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialUseForAuth: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockExecuteManagedToken: vi.fn(),
  mockGetCredential: vi.fn(),
  mockGetToolMetadata: vi.fn(),
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
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/credentials/application/managed-oauth-delegation', () => ({
  InvalidManagedOAuthDelegationError: class InvalidManagedOAuthDelegationError extends Error {
    constructor() {
      super('Managed credential execution requires valid workflow delegation')
      this.name = 'InvalidManagedOAuthDelegationError'
    }
  },
  authenticateManagedOAuthDelegation: vi.fn(),
}))

vi.mock('@/lib/credentials/application/resolve-managed-oauth-token', () => ({
  resolveManagedOAuthCredentialToken: { execute: mockExecuteManagedToken },
}))

vi.mock('@/lib/credentials/managed-oauth', () => ({
  ManagedOAuthCredentialError: class ManagedOAuthCredentialError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly statusCode: number
    ) {
      super(message)
      this.name = 'ManagedOAuthCredentialError'
    }
  },
}))

vi.mock('@/tools/metadata', () => ({
  getToolMetadata: mockGetToolMetadata,
}))

vi.mock('@/lib/oauth/utils', () => ({
  getCanonicalScopesForProvider: vi.fn().mockReturnValue([]),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { InvalidManagedOAuthDelegationError } from '@/lib/credentials/application/managed-oauth-delegation'
import { resolveCredentialAccessToken, resolveCredentialToken } from '@/lib/oauth/token-resolution'

const INTERNAL_AUTH = { success: true, userId: 'user-1', authType: 'internal_jwt' } as const

describe('resolveCredentialToken', () => {
  it('fails closed when the credential is not authorized', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: false,
      error: 'You do not have access to this credential.',
    })

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      resolvedCredential: null,
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
      resolvedCredential: null,
      credentialId: 'cred-1',
      workflowId: 'wf-1',
    })

    expect(result).toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: 'id-token' },
    })
    expect(mockGetCredential).toHaveBeenCalledWith('req-1', 'account-1', 'owner-1')
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        workspaceId: 'ws-1',
        resourceId: 'account-1',
        action: 'credential.accessed',
      })
    )
  })

  it('projects the realm and environment bound to the QuickBooks account identity', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'account-1',
    })
    mockGetCredential.mockResolvedValue({
      providerId: 'quickbooks',
      accountId:
        'quickbooks:v2:NkYPLLqX2cM-QABxg0vbv71mQS9s_aRP3v7ZKLvnJyo:sandbox:1234567890:dXNlci0x',
    })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'fresh', refreshed: false })

    await expect(
      resolveCredentialToken(INTERNAL_AUTH, {
        requestId: 'req-1',
        resolvedCredential: null,
        credentialId: 'cred-1',
      })
    ).resolves.toEqual({
      ok: true,
      token: {
        accessToken: 'fresh',
        credentialType: 'oauth',
        idToken: undefined,
        realmId: '1234567890',
        quickBooksEnvironment: 'sandbox',
      },
    })
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
      resolvedCredential: null,
      credentialId: 'cred-1',
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'Failed to refresh access token' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('authorizes service-account credentials before minting a token', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({ ok: false, error: 'Unauthorized' })

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
      resolvedCredential: {
        credentialType: 'service_account',
        credentialId: 'sa-1',
        providerId: 'google',
        workspaceId: 'ws-1',
        accountId: '',
        usedCredentialTable: true,
      },
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Unauthorized' })
    expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })

  it('rejects a malformed impersonation subject before touching the credential', async () => {
    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      resolvedCredential: null,
      credentialId: 'cred-1',
      impersonateEmail: 'not-an-email',
    })

    expect(result.ok).toBe(false)
    expect(mockAuthorizeCredentialUseForAuth).not.toHaveBeenCalled()
  })
})

const MANAGED_RESOLVED = {
  credentialType: 'managed_oauth',
  credentialId: 'managed-1',
  providerId: 'google',
  workspaceId: 'ws-1',
  accountId: '',
  usedCredentialTable: true,
} as const

const EXECUTOR_PRINCIPAL = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'ws-1',
} as never

describe('resolveCredentialAccessToken', () => {
  const authenticate = vi.fn()
  const resolveManagedPrincipal = vi.fn()

  beforeEach(() => {
    mockResolveOAuthAccountId.mockResolvedValue(null)
    authenticate.mockResolvedValue(INTERNAL_AUTH)
    resolveManagedPrincipal.mockResolvedValue(EXECUTOR_PRINCIPAL)
    mockGetToolMetadata.mockReturnValue({
      oauth: { required: true, provider: 'google', requiredScopes: ['scope-a'] },
    })
  })

  it('rejects a managed credential when no delegation resolver is wired', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      authenticate,
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      code: 'MANAGED_CREDENTIAL_DELEGATION_REQUIRED',
      error: 'Managed credentials can only be used by an authenticated workflow execution',
    })
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('maps an invalid delegation to 401 with its message', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    resolveManagedPrincipal.mockRejectedValue(new InvalidManagedOAuthDelegationError())

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'MANAGED_CREDENTIAL_DELEGATION_INVALID',
      error: 'Managed credential execution requires valid workflow delegation',
    })
    expect(resolveManagedPrincipal).toHaveBeenCalledWith('managed-1')
  })

  it('requires a tool id for managed credentials', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'MANAGED_CREDENTIAL_TOOL_REQUIRED',
      error: 'A tool ID is required to use a managed credential',
    })
  })

  it('rejects tools without managed OAuth support', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockGetToolMetadata.mockReturnValue({ oauth: undefined })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'http_request',
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      code: 'MANAGED_CREDENTIAL_TOOL_UNSUPPORTED',
      error: 'This tool is not configured to use managed credentials',
    })
    expect(mockExecuteManagedToken).not.toHaveBeenCalled()
  })

  it('rejects tools whose scope policy is empty', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockGetToolMetadata.mockReturnValue({ oauth: { required: true, provider: 'google' } })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      code: 'MANAGED_CREDENTIAL_TOOL_UNSUPPORTED',
      error: 'This tool is not configured to use managed credentials',
    })
  })

  it("scopes a managed credential to the tool's required scopes", async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockExecuteManagedToken.mockResolvedValue({ accessToken: 'managed-token', idToken: 'id-1' })
    const auditRequest = { headers: { get: () => null } }

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      auditRequest,
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: true,
      token: {
        accessToken: 'managed-token',
        credentialType: 'managed_oauth',
        idToken: 'id-1',
      },
    })
    expect(mockExecuteManagedToken).toHaveBeenCalledWith({
      principal: EXECUTOR_PRINCIPAL,
      input: {
        credentialId: 'managed-1',
        expectedProviderId: 'google',
        requiredScopes: ['scope-a'],
        toolId: 'gmail_send',
      },
      request: auditRequest,
    })
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('projects orchestration failures as managed unauthorized', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockExecuteManagedToken.mockRejectedValue(
      new OrchestrationError('not_found', 'Managed credential not found')
    )

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      code: 'MANAGED_CREDENTIAL_UNAUTHORIZED',
      error: 'Managed credential not found',
    })
  })
})
