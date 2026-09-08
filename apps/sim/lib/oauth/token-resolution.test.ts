/**
 * @vitest-environment node
 */
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

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { InvalidManagedOAuthDelegationError } from '@/lib/credentials/application/managed-oauth-delegation'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { resolveCredentialAccessToken, resolveCredentialToken } from '@/lib/oauth/token-resolution'
import { getBlockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

const INTERNAL_AUTH = { success: true, userId: 'user-1', authType: 'internal_jwt' } as const

describe('resolveCredentialToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('fails closed when the caller carries no user id', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: false,
      error: 'Authentication required',
    })

    const result = await resolveCredentialToken(
      { success: true, authType: 'internal_jwt' },
      { requestId: 'req-1', credentialId: 'cred-1', resolvedCredential: null }
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
      resolvedCredential: null,
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
      resolvedCredential: null,
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
        resolvedCredential: null,
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
        resolvedCredential: null,
        credentialId: 'cred-1',
      })
    ).resolves.toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: undefined },
    })
    expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
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

  it('surfaces the classified service-account failure code', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({ ok: true, requesterUserId: 'user-1' })
    mockResolveServiceAccountToken.mockRejectedValue(
      new TokenServiceAccountValidationError('invalid_credentials', 401)
    )

    const result = await resolveCredentialToken(INTERNAL_AUTH, {
      requestId: 'req-1',
      credentialId: 'cred-1',
      resolvedCredential: {
        credentialType: 'service_account',
        credentialId: 'sa-1',
        providerId: 'atlassian',
        workspaceId: 'ws-1',
        accountId: '',
        usedCredentialTable: true,
      },
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
    vi.clearAllMocks()
    mockResolveOAuthAccountId.mockResolvedValue(null)
    authenticate.mockResolvedValue(INTERNAL_AUTH)
    resolveManagedPrincipal.mockResolvedValue(EXECUTOR_PRINCIPAL)
    mockGetToolMetadata.mockReturnValue({
      oauth: { required: true, provider: 'google', requiredScopes: ['scope-a'] },
    })
  })

  it('authenticates and delegates non-managed credentials without a second account lookup', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'account-1',
    })
    mockGetCredential.mockResolvedValue({ providerId: 'google' })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'fresh', refreshed: false })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      workflowId: 'wf-1',
      callerUserId: 'user-1',
      authenticate,
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: undefined },
    })
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(resolveManagedPrincipal).not.toHaveBeenCalled()
    expect(mockResolveOAuthAccountId).toHaveBeenCalledTimes(1)
    expect(mockAuthorizeCredentialUseForAuth).toHaveBeenCalledWith(INTERNAL_AUTH, {
      credentialId: 'cred-1',
      workflowId: 'wf-1',
      callerUserId: 'user-1',
    })
  })

  it('treats an empty impersonation subject as absent', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'account-1',
    })
    mockGetCredential.mockResolvedValue({ providerId: 'google' })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'fresh', refreshed: false })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      impersonateEmail: '',
      authenticate,
    })

    expect(result).toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: undefined },
    })
  })

  describe('consuming-tool credential compatibility', () => {
    const run = () =>
      resolveCredentialAccessToken({
        requestId: 'req-compatibility',
        credentialId: 'supplied-alias',
        workflowId: 'wf-1',
        toolId: 'registered_tool',
        authenticate,
      })

    function selectCredential(providerId: string, kind: 'oauth' | 'service-account') {
      mockResolveOAuthAccountId.mockResolvedValue({
        credentialType: kind === 'service-account' ? 'service_account' : 'oauth',
        credentialId: 'canonical-1',
        accountId: 'canonical-1',
        providerId,
        workspaceId: 'ws-1',
        usedCredentialTable: true,
      })
      mockGetCredential.mockResolvedValue({ providerId })
    }

    function legacyOwner(serviceId: string): BlockConfig {
      return {
        tools: { access: ['registered_tool'] },
        subBlocks: [{ id: 'oauthCredential', type: 'oauth-input', serviceId }],
      } as BlockConfig
    }

    beforeEach(() => {
      mockAuthorizeCredentialUseForAuth.mockResolvedValue({
        ok: true,
        requesterUserId: 'user-1',
        credentialOwnerUserId: 'owner-1',
        workspaceId: 'ws-1',
        resolvedCredentialId: 'canonical-1',
      })
      mockResolveServiceAccountToken.mockResolvedValue({ accessToken: 'minted' })
      mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'refreshed' })
      vi.mocked(getBlockRegistry).mockReturnValue({})
    })

    it.each([
      { service: 'salesforce', provider: 'salesforce', kind: 'oauth', accepted: true },
      { service: 'salesforce', provider: 'salesforce-sandbox', kind: 'oauth', accepted: true },
      { service: 'salesforce', provider: 'jira', kind: 'oauth', accepted: false },
      {
        service: 'jira',
        provider: 'atlassian-service-account',
        kind: 'service-account',
        accepted: true,
      },
      {
        service: 'confluence',
        provider: 'atlassian-service-account',
        kind: 'service-account',
        accepted: true,
      },
      {
        service: 'netsuite',
        provider: 'snowflake-service-account',
        kind: 'service-account',
        accepted: false,
      },
      { service: 'netsuite', provider: 'netsuite', kind: 'oauth', accepted: false },
      {
        service: 'jira',
        provider: 'atlassian-service-account',
        kind: 'oauth',
        accepted: false,
      },
    ] as const)('$service with $provider ($kind): accepted=$accepted', async (testCase) => {
      selectCredential(testCase.provider, testCase.kind)
      mockGetToolMetadata.mockReturnValue({
        id: 'registered_tool',
        oauth: { required: true, provider: testCase.service },
      })

      const result = await run()

      expect(result.ok).toBe(testCase.accepted)
      expect(mockAuthorizeCredentialUseForAuth).toHaveBeenCalledWith(INTERNAL_AUTH, {
        credentialId: 'supplied-alias',
        workflowId: 'wf-1',
        callerUserId: undefined,
      })
      if (!testCase.accepted) {
        expect(result).toEqual({
          ok: false,
          status: 403,
          code: 'CREDENTIAL_TOOL_MISMATCH',
          error: 'Credential is not compatible with this tool',
        })
        expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
        expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
        expect(mockRecordAudit).not.toHaveBeenCalled()
      } else if (testCase.kind === 'service-account') {
        expect(mockResolveServiceAccountToken).toHaveBeenCalledWith(
          'canonical-1',
          testCase.provider,
          [],
          undefined
        )
      } else {
        expect(mockGetCredential).toHaveBeenCalledWith(
          'req-compatibility',
          'canonical-1',
          'owner-1'
        )
        expect(mockRefreshTokenIfNeeded).toHaveBeenCalledWith(
          'req-compatibility',
          { providerId: testCase.provider },
          'canonical-1'
        )
      }
    })

    it('honors an explicit kind restriction before minting an otherwise compatible provider', async () => {
      selectCredential('atlassian-service-account', 'service-account')
      mockGetToolMetadata.mockReturnValue({
        oauth: { required: true, provider: 'jira', credentialKind: 'oauth' },
      })

      expect(await run()).toMatchObject({ ok: false, code: 'CREDENTIAL_TOOL_MISMATCH' })
      expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
    })

    it.each(['oauth', 'service-account'] as const)(
      'does not inspect tool compatibility or return a token before %s access is authorized',
      async (kind) => {
        selectCredential('unrelated-provider', kind)
        mockAuthorizeCredentialUseForAuth.mockResolvedValue({
          ok: false,
          error: 'Credential is not accessible from this workflow workspace',
        })

        expect(await run()).toEqual({
          ok: false,
          status: 403,
          error: 'Credential is not accessible from this workflow workspace',
        })
        expect(mockGetToolMetadata).not.toHaveBeenCalled()
        expect(mockGetCredential).not.toHaveBeenCalled()
        expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
        expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
      }
    )

    it('keeps legacy tools with one explicitly declared owning service working', async () => {
      selectCredential('netsuite-service-account', 'service-account')
      mockGetToolMetadata.mockReturnValue({
        id: 'registered_tool',
        params: { oauthCredential: { type: 'string', required: true } },
      })
      vi.mocked(getBlockRegistry).mockReturnValue({
        first: legacyOwner('netsuite'),
        second: legacyOwner('netsuite'),
      })

      expect(await run()).toMatchObject({ ok: true, token: { accessToken: 'minted' } })
    })

    it.each(['missing owner', 'ambiguous owners', 'unknown service', 'unknown tool'])(
      'rejects a %s instead of guessing the consuming service',
      async (failure) => {
        selectCredential('netsuite-service-account', 'service-account')
        mockGetToolMetadata.mockReturnValue({
          id: 'registered_tool',
          params: { oauthCredential: { type: 'string', required: true } },
        })
        if (failure === 'ambiguous owners') {
          vi.mocked(getBlockRegistry).mockReturnValue({
            first: legacyOwner('netsuite'),
            second: legacyOwner('snowflake'),
          })
        } else if (failure === 'unknown service') {
          mockGetToolMetadata.mockReturnValue({
            oauth: { required: true, provider: 'unregistered-service' },
          })
          vi.mocked(getBlockRegistry).mockReturnValue({ first: legacyOwner('netsuite') })
        } else if (failure === 'unknown tool') {
          mockGetToolMetadata.mockReturnValue(undefined)
        }

        expect(await run()).toMatchObject({ ok: false, code: 'CREDENTIAL_TOOL_MISMATCH' })
        expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
        expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
      }
    )
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

  it('rethrows unexpected delegation resolver failures', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    resolveManagedPrincipal.mockRejectedValue(new Error('db unavailable'))

    await expect(
      resolveCredentialAccessToken({
        requestId: 'req-1',
        credentialId: 'cred-1',
        toolId: 'gmail_send',
        authenticate,
        resolveManagedPrincipal,
      })
    ).rejects.toThrow('db unavailable')
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

  it('resolves a managed credential through the use case and records analytics', async () => {
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
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'credential_used',
      expect.objectContaining({ credential_type: 'managed_oauth', provider_id: 'google' }),
      { groups: { workspace: 'ws-1' } }
    )
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('projects managed credential rejections with their code and status', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockExecuteManagedToken.mockRejectedValue(
      new (
        ManagedOAuthCredentialError as never as new (
          message: string,
          code: string,
          statusCode: number
        ) => Error
      )('Credential is disabled', 'MANAGED_CREDENTIAL_DISABLED', 403)
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
      status: 403,
      code: 'MANAGED_CREDENTIAL_DISABLED',
      error: 'Credential is disabled',
    })
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
