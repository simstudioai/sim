import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { credentialsManagedOauthMock } from '@sim/testing/mocks/credentials-managed-oauth.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeCredentialUseForAuth, mockExecuteManagedToken } = vi.hoisted(() => ({
  mockAuthorizeCredentialUseForAuth: vi.fn(),
  mockExecuteManagedToken: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mockAuthorizeCredentialUseForAuth,
}))

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/credentials/application/managed-oauth-delegation', () => ({
  InvalidManagedOAuthDelegationError: class InvalidManagedOAuthDelegationError extends Error {
    constructor() {
      super('Managed credential execution requires valid workflow delegation')
      this.name = 'InvalidManagedOAuthDelegationError'
    }
  },
}))

vi.mock('@/lib/credentials/application/resolve-managed-oauth-token', () => ({
  resolveManagedOAuthCredentialToken: { execute: mockExecuteManagedToken },
}))

vi.mock('@/lib/credentials/managed-oauth', () => credentialsManagedOauthMock)

vi.unmock('@/lib/oauth/utils')

import { OutboundRoutingError } from '@/lib/core/network/routing'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { InvalidManagedOAuthDelegationError } from '@/lib/credentials/application/managed-oauth-delegation'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { resolveCredentialAccessToken } from '@/lib/oauth/token-resolution'
import type { OAuthService } from '@/lib/oauth/types'
import { getToolMetadata } from '@/tools/metadata'

const mockGetToolMetadata = vi.mocked(getToolMetadata)

const mockRecordAudit = auditMockFns.mockRecordAudit
const {
  mockGetCredential,
  mockRefreshTokenIfNeeded,
  mockResolveOAuthAccountId,
  mockResolveServiceAccountToken,
} = authOAuthUtilsMockFns

describe('resolveCredentialAccessToken for plain credentials', () => {
  beforeEach(() => {
    mockResolveOAuthAccountId.mockResolvedValue(null)
  })

  it('fails closed when the credential is not authorized', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: false,
      error: 'You do not have access to this credential.',
    })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      userId: 'user-1',
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
    expect(auditMockFns.mockRecordAuditRollup).not.toHaveBeenCalled()
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

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      userId: 'user-1',
      credentialId: 'cred-1',
      workflowId: 'wf-1',
    })

    expect(result).toEqual({
      ok: true,
      token: { accessToken: 'fresh', credentialType: 'oauth', idToken: 'id-token' },
    })
    expect(mockAuthorizeCredentialUseForAuth).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ credentialId: 'cred-1', workflowId: 'wf-1' })
    )
    expect(mockGetCredential).toHaveBeenCalledWith('req-1', 'account-1', 'owner-1')
    expect(auditMockFns.mockRecordAuditRollup).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          actorId: 'user-1',
          workspaceId: 'ws-1',
          resourceId: 'account-1',
          action: 'credential.accessed',
        }),
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
      resolveCredentialAccessToken({
        requestId: 'req-1',
        userId: 'user-1',
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

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      userId: 'user-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'Failed to refresh access token' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAuditRollup).not.toHaveBeenCalled()
  })

  it('reports an unavailable egress route as 503, not a failed credential', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockGetCredential.mockResolvedValue({ providerId: 'google' })
    mockRefreshTokenIfNeeded.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      userId: 'user-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "The organization's egress route is unavailable",
    })
  })

  it('authorizes service-account credentials before minting a token', async () => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({ ok: false, error: 'Unauthorized' })

    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      credentialId: 'sa-1',
      providerId: 'google',
      workspaceId: 'ws-1',
      accountId: '',
      usedCredentialTable: true,
    })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      userId: 'user-1',
      credentialId: 'cred-1',
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Unauthorized' })
    expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })

  it('rejects a malformed impersonation subject before touching the credential', async () => {
    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      userId: 'user-1',
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
  const resolveManagedPrincipal = vi.fn()

  beforeEach(() => {
    mockExecuteManagedToken.mockReset()
    mockResolveOAuthAccountId.mockResolvedValue(null)
    resolveManagedPrincipal.mockResolvedValue(EXECUTOR_PRINCIPAL)
    mockGetToolMetadata.mockReturnValue({
      id: 'gmail_send',
      params: {},
      oauth: { required: true, provider: 'google', requiredScopes: ['scope-a'] },
    })
  })

  it('rejects a managed credential when no delegation resolver is wired', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      userId: 'user-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      code: 'MANAGED_CREDENTIAL_DELEGATION_REQUIRED',
      error: 'Managed credentials can only be used by an authenticated workflow execution',
    })
    expect(mockAuthorizeCredentialUseForAuth).not.toHaveBeenCalled()
  })

  it('maps an invalid delegation to 401 with its message', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    resolveManagedPrincipal.mockRejectedValue(new InvalidManagedOAuthDelegationError())

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      userId: 'user-1',
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
      userId: 'user-1',
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
    mockGetToolMetadata.mockReturnValue({ id: 'http_request', params: {}, oauth: undefined })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'http_request',
      userId: 'user-1',
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

  it('rejects a managed OAuth credential for a service-account-only tool before token resolution', async () => {
    mockResolveOAuthAccountId.mockResolvedValueOnce({
      ...MANAGED_RESOLVED,
      providerId: 'slack',
    })
    mockGetToolMetadata.mockReturnValueOnce({
      id: 'slack_add_bookmark',
      params: {},
      oauth: {
        required: true,
        provider: 'slack',
        requiredScopes: ['bookmarks:write'],
        credentialKind: 'service-account',
      },
    })
    mockExecuteManagedToken.mockResolvedValueOnce({ accessToken: 'managed-token' })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'slack_add_bookmark',
      userId: 'user-1',
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'CREDENTIAL_TYPE_MISMATCH',
      error: 'The selected credential type is not supported by this tool',
    })
    expect(mockExecuteManagedToken).not.toHaveBeenCalled()
  })

  it('rejects tools whose scope policy is empty', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockGetToolMetadata.mockReturnValue({
      id: 'fixture-tool',
      params: {},
      oauth: { required: true, provider: 'oracle-fusion' },
    })

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      userId: 'user-1',
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
    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      userId: 'user-1',
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
    })
    expect(mockAuthorizeCredentialUseForAuth).not.toHaveBeenCalled()
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
      userId: 'user-1',
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      code: 'MANAGED_CREDENTIAL_UNAUTHORIZED',
      error: 'Managed credential not found',
    })
  })

  it('reports a managed refresh blocked by the egress route as a retryable 503, not unauthorized', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(MANAGED_RESOLVED)
    mockExecuteManagedToken.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    const result = await resolveCredentialAccessToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      toolId: 'gmail_send',
      userId: 'user-1',
      resolveManagedPrincipal,
    })

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "The organization's egress route is unavailable",
    })
  })
})

describe('ordinary tool credential binding', () => {
  const serviceAccount = {
    credentialType: 'service_account',
    credentialId: 'service-account-1',
    providerId: 'oracle-fusion-service-account',
    accountId: '',
    workspaceId: 'workspace-1',
    usedCredentialTable: true,
  } as const

  beforeEach(() => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockResolveOAuthAccountId.mockResolvedValue(serviceAccount)
    mockResolveServiceAccountToken.mockResolvedValue({ accessToken: 'service-token' })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'oauth-token' })
    mockGetToolMetadata.mockReturnValue({
      id: 'fixture-tool',
      params: {},
      oauth: { required: true, provider: 'oracle-fusion', credentialKind: 'service-account' },
    })
  })

  it('refuses to release a service-account secret without a tool to bind it to', async () => {
    const result = await resolveCredentialAccessToken({
      requestId: 'binding-test',
      credentialId: 'credential-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({ ok: false, status: 400, code: 'SERVICE_ACCOUNT_TOOL_REQUIRED' })
    expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })

  it.each(['vanta', 'oracle-epm-service-account', 'unknown-provider'])(
    'rejects an authorized %s credential before minting a Fusion token',
    async (providerId) => {
      mockResolveOAuthAccountId.mockResolvedValue({ ...serviceAccount, providerId })
      const result = await resolveCredentialAccessToken({
        requestId: 'binding-test',
        credentialId: 'credential-1',
        toolId: 'oracle_fusion_financials_list_payables_invoices',
        userId: 'user-1',
      })
      expect(result).toMatchObject({ ok: false, status: 400, code: 'CREDENTIAL_PROVIDER_MISMATCH' })
      expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
      expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
      expect(mockRecordAudit).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAuditRollup).not.toHaveBeenCalled()
    }
  )

  describe('hybrid tools (inline secrets or an optional saved credential)', () => {
    beforeEach(() => {
      mockGetToolMetadata.mockReturnValue({
        id: 'dynamodb_get',
        params: {},
        oauth: { required: false, provider: 'aws', credentialKind: 'service-account' },
      })
    })

    it('resolves a saved credential of the tool provider', async () => {
      mockResolveOAuthAccountId.mockResolvedValue({
        ...serviceAccount,
        providerId: 'aws-service-account',
      })
      const result = await resolveCredentialAccessToken({
        requestId: 'binding-test',
        credentialId: 'credential-1',
        toolId: 'dynamodb_get',
        userId: 'user-1',
      })
      expect(result).toMatchObject({ ok: true })
      expect(mockResolveServiceAccountToken).toHaveBeenCalled()
    })

    it.each(['oracle-fusion-service-account', 'databricks-service-account', 'unknown-provider'])(
      'still rejects an authorized %s credential',
      async (providerId) => {
        mockResolveOAuthAccountId.mockResolvedValue({ ...serviceAccount, providerId })
        const result = await resolveCredentialAccessToken({
          requestId: 'binding-test',
          credentialId: 'credential-1',
          toolId: 'dynamodb_get',
          userId: 'user-1',
        })
        expect(result).toMatchObject({
          ok: false,
          status: 400,
          code: 'CREDENTIAL_PROVIDER_MISMATCH',
        })
        expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
      }
    )
  })

  it('does not reveal provider mismatch to an unauthorized caller', async () => {
    mockResolveOAuthAccountId.mockResolvedValue({ ...serviceAccount, providerId: 'vanta' })
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(
      await resolveCredentialAccessToken({
        requestId: 'binding-test',
        credentialId: 'credential-1',
        toolId: 'oracle_fusion_financials_list_payables_invoices',
        userId: 'user-1',
      })
    ).toEqual({ ok: false, status: 403, error: 'Unauthorized' })
    expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })

  it('rejects a plain OAuth credential for a service-account-only tool before refreshing', async () => {
    mockResolveOAuthAccountId.mockResolvedValue(null)
    mockGetCredential.mockResolvedValue({ providerId: 'oracle-fusion' })
    expect(
      await resolveCredentialAccessToken({
        requestId: 'binding-test',
        credentialId: 'credential-1',
        toolId: 'oracle_fusion_financials_list_payables_invoices',
        userId: 'user-1',
      })
    ).toMatchObject({ ok: false, status: 400, code: 'CREDENTIAL_TYPE_MISMATCH' })
    expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
  })

  it('releases the application key a Datadog key pair resolves beside its API key', async () => {
    mockGetToolMetadata.mockReturnValue({
      id: 'fixture-tool',
      params: {},
      oauth: { required: false, provider: 'datadog', credentialKind: 'service-account' },
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      ...serviceAccount,
      providerId: 'datadog-service-account',
    })
    mockResolveServiceAccountToken.mockResolvedValue({
      accessToken: 'dd-api-key',
      applicationKey: 'dd-application-key',
      domain: 'datadoghq.eu',
    })

    expect(
      await resolveCredentialAccessToken({
        requestId: 'binding-test',
        credentialId: 'credential-1',
        toolId: 'fixture-tool',
        userId: 'user-1',
      })
    ).toMatchObject({
      ok: true,
      token: {
        accessToken: 'dd-api-key',
        applicationKey: 'dd-application-key',
        domain: 'datadoghq.eu',
      },
    })
  })

  it.each([
    ['oracle-fusion', 'oracle-fusion-service-account'],
    ['vanta', 'vanta-service-account'],
    ['ramp', 'ramp-service-account'],
    ['greenhouse', 'greenhouse-service-account'],
    ['crowdstrike', 'crowdstrike-service-account'],
    ['datadog', 'datadog-service-account'],
    ['sailpoint', 'sailpoint-service-account'],
    ['zoominfo', 'zoominfo-service-account'],
    ['google-email', 'google-service-account'],
    ['jira', 'atlassian-service-account'],
    ['confluence', 'atlassian-service-account'],
  ] as const)(
    'accepts the canonical %s service-account provider %s',
    async (provider, providerId) => {
      mockGetToolMetadata.mockReturnValue({
        id: 'fixture-tool',
        params: {},
        oauth: { required: true, provider },
      })
      mockResolveOAuthAccountId.mockResolvedValue({ ...serviceAccount, providerId })
      expect(
        await resolveCredentialAccessToken({
          requestId: 'binding-test',
          credentialId: 'credential-1',
          toolId: 'fixture-tool',
          userId: 'user-1',
        })
      ).toMatchObject({
        ok: true,
        token: { accessToken: 'service-token', credentialType: 'service_account' },
      })
    }
  )

  it.each([
    ['google-email', 'google-email', true],
    ['salesforce', 'salesforce-sandbox', true],
    ['salesforce', 'google', false],
  ] as const)(
    'binds ordinary OAuth %s tokens to the provider (%s)',
    async (provider, providerId, allowed) => {
      mockGetToolMetadata.mockReturnValue({
        id: 'fixture-tool',
        params: {},
        oauth: { required: true, provider },
      })
      mockResolveOAuthAccountId.mockResolvedValue(null)
      mockGetCredential.mockResolvedValue({ providerId })
      const result = await resolveCredentialAccessToken({
        requestId: 'binding-test',
        credentialId: 'credential-1',
        toolId: 'fixture-tool',
        userId: 'user-1',
      })
      expect(result.ok).toBe(allowed)
      if (!allowed) {
        expect(result).toMatchObject({ status: 400, code: 'CREDENTIAL_PROVIDER_MISMATCH' })
        expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
      }
    }
  )
})

describe('Microsoft app credential binding', () => {
  const appCredential = {
    credentialType: 'service_account',
    credentialId: 'microsoft-app-1',
    providerId: 'microsoft-app-service-account',
    accountId: '',
    workspaceId: 'workspace-1',
    usedCredentialTable: true,
  } as const

  beforeEach(() => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockResolveOAuthAccountId.mockResolvedValue(appCredential)
    mockResolveServiceAccountToken.mockReset()
    mockResolveServiceAccountToken.mockResolvedValue({ accessToken: 'app-token' })
  })

  function toolFor(provider: OAuthService) {
    mockGetToolMetadata.mockReturnValue({
      id: `${provider}-tool`,
      params: {},
      oauth: { required: true, provider },
    })
  }

  it.each([
    'outlook',
    'onedrive',
    'microsoft-excel',
    'microsoft-word',
    'microsoft-planner',
    'microsoft-teams',
  ] as const)(
    'refuses an app credential for %s, which acts as a signed-in person',
    async (provider) => {
      toolFor(provider)
      const result = await resolveCredentialAccessToken({
        requestId: 'microsoft-app',
        credentialId: 'microsoft-app-1',
        toolId: `${provider}-tool`,
        userId: 'user-1',
      })
      expect(result).toMatchObject({ ok: false, status: 400, code: 'CREDENTIAL_PROVIDER_MISMATCH' })
      expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
    }
  )

  it.each(['microsoft-ad', 'sharepoint', 'microsoft-dataverse', 'microsoft-intune'] as const)(
    'mints an app-only token for %s and tells the resolver which service it is for',
    async (provider) => {
      toolFor(provider)
      const result = await resolveCredentialAccessToken({
        requestId: 'microsoft-app',
        credentialId: 'microsoft-app-1',
        toolId: `${provider}-tool`,
        userId: 'user-1',
      })
      expect(result).toMatchObject({ ok: true, token: { credentialType: 'service_account' } })
      expect(mockResolveServiceAccountToken).toHaveBeenCalledWith(
        'microsoft-app-1',
        'microsoft-app-service-account',
        expect.any(Array),
        undefined,
        { service: provider }
      )
    }
  )

  it('refuses an app credential for Reset password, which Graph allows only for a signed-in admin', async () => {
    const { resetPasswordTool } = await import('@/tools/microsoft_ad/reset_password')
    mockGetToolMetadata.mockReturnValue(resetPasswordTool)
    const result = await resolveCredentialAccessToken({
      requestId: 'microsoft-app',
      credentialId: 'microsoft-app-1',
      toolId: resetPasswordTool.id,
      userId: 'user-1',
    })
    expect(result).toMatchObject({ ok: false, status: 400, code: 'CREDENTIAL_TYPE_MISMATCH' })
    expect(mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })
})

describe('keyless Google Cloud credential refusals', () => {
  beforeEach(() => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      credentialId: 'google-keyless-1',
      providerId: 'google-service-account',
      accountId: '',
      workspaceId: 'workspace-1',
      usedCredentialTable: true,
    })
    mockGetToolMetadata.mockReturnValue({
      id: 'google-drive-tool',
      params: {},
      oauth: { required: true, provider: 'google-drive' },
    })
    mockResolveServiceAccountToken.mockReset()
  })

  it('falls back to a provider-neutral message when the refusal carries none', async () => {
    mockResolveServiceAccountToken.mockRejectedValue(
      new TokenServiceAccountValidationError('unsupported_use', 400)
    )
    const result = await resolveCredentialAccessToken({
      requestId: 'google-keyless',
      credentialId: 'google-keyless-1',
      toolId: 'google-drive-tool',
      userId: 'user-1',
    })
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'unsupported_use',
      error: 'This credential cannot be used here',
    })
  })

  it('tells the caller to fix the host when egress refuses it, instead of a generic 401', async () => {
    mockResolveServiceAccountToken.mockRejectedValue(
      new TokenServiceAccountValidationError('host_not_allowed', 400)
    )
    const result = await resolveCredentialAccessToken({
      requestId: 'servicenow-host',
      credentialId: 'google-keyless-1',
      toolId: 'google-drive-tool',
      userId: 'user-1',
    })
    expect(result).toMatchObject({ ok: false, status: 400, code: 'host_not_allowed' })
  })
})

describe('Microsoft app credential cloud refusals', () => {
  beforeEach(() => {
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'owner-1',
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      credentialId: 'microsoft-app-gov',
      providerId: 'microsoft-app-service-account',
      accountId: '',
      workspaceId: 'workspace-1',
      usedCredentialTable: true,
    })
    mockGetToolMetadata.mockReturnValue({
      id: 'powerbi-tool',
      params: {},
      oauth: { required: true, provider: 'microsoft-powerbi' },
    })
    mockResolveServiceAccountToken.mockReset()
    mockResolveServiceAccountToken.mockRejectedValue(
      new TokenServiceAccountValidationError('cloud_mismatch', 400)
    )
  })

  it('names the cloud mismatch instead of asking to reconnect the credential', async () => {
    const result = await resolveCredentialAccessToken({
      requestId: 'microsoft-cloud',
      credentialId: 'microsoft-app-gov',
      toolId: 'powerbi-tool',
      userId: 'user-1',
    })
    expect(result).toMatchObject({ ok: false, status: 400, code: 'cloud_mismatch' })
    expect(result.ok ? '' : result.error).toMatch(/Microsoft cloud/)
    expect(result.ok ? '' : result.error).not.toMatch(/reconnect/)
  })
})
