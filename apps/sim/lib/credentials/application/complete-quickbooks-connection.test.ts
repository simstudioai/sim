import { account } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { oauthUtilsMock, oauthUtilsMockFns } from '@sim/testing/mocks/oauth-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  decryptClientConfig: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  fetchConnectionProfile: vi.fn(),
  getActiveDraft: vi.fn(),
  processDraft: vi.fn(),
  resolveTarget: vi.fn(),
}))

vi.mock('@sim/utils/id', () => idMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/credentials/application/connection-target', () => ({
  resolveCredentialConnectionTarget: hoisted.resolveTarget,
}))
vi.mock('@/lib/credentials/connect-draft', () => ({
  getActiveConnectDraft: hoisted.getActiveDraft,
}))
vi.mock('@/lib/credentials/draft-processor', () => ({
  processCredentialDraft: hoisted.processDraft,
}))
vi.mock('@/lib/oauth/quickbooks-client-config', () => ({
  decryptQuickBooksOAuthClientConfig: hoisted.decryptClientConfig,
}))
vi.mock('@/lib/oauth/quickbooks', () => ({
  exchangeQuickBooksAuthorizationCode: hoisted.exchangeAuthorizationCode,
  fetchQuickBooksConnectionProfile: hoisted.fetchConnectionProfile,
}))
vi.mock('@/lib/oauth/utils', () => oauthUtilsMock)

import { completeQuickBooksConnection } from '@/lib/credentials/application/complete-quickbooks-connection'

const mocks = {
  ...hoisted,
  generateId: idMockFns.mockGenerateId,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

oauthUtilsMockFns.mockGetCanonicalScopesForProvider.mockReturnValue([
  'com.intuit.quickbooks.accounting',
  'openid',
])

const principal = createSessionPrincipal()

describe('completeQuickBooksConnection', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.generateId.mockReturnValue('new-account-id')
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getActiveDraft.mockResolvedValue({
      id: 'draft-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'quickbooks',
      credentialId: null,
      displayName: 'QuickBooks Sandbox',
      description: null,
      oauthConfig: 'encrypted-client-config',
      createdAt: new Date('2026-09-04T18:00:00.000Z'),
      expiresAt: new Date('2026-09-04T18:10:00.000Z'),
    })
    mocks.resolveTarget.mockResolvedValue({ providerId: 'quickbooks' })
    mocks.decryptClientConfig.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox',
      webhookVerifierToken: 'verifier-token',
    })
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 8_726_400,
      scope: '',
    })
    mocks.fetchConnectionProfile.mockResolvedValue({
      accountId:
        'quickbooks:v2:bGFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE:sandbox:1234567890:dXNlci0x',
      appKey: 'bGFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE',
      realmId: '1234567890',
      subject: 'user-1',
      environment: 'sandbox',
      name: 'Test User',
      email: 'user@example.com',
      emailVerified: true,
    })
    mocks.processDraft.mockResolvedValue(undefined)
  })

  it('uses only the encrypted draft config and provider-validated company identity', async () => {
    queueTableRows(account, [])

    await expect(
      completeQuickBooksConnection.execute({
        principal,
        input: {
          draftId: 'draft-1',
          code: 'authorization-code',
          realmId: '1234567890',
          redirectUri: 'https://sim.test/api/auth/oauth2/callback/quickbooks',
        },
      })
    ).resolves.toEqual({
      accountId: 'new-account-id',
      environment: 'sandbox',
      realmId: '1234567890',
    })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId:
          'quickbooks:v2:bGFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE:sandbox:1234567890:dXNlci0x',
        providerId: 'quickbooks',
        oauthConfig: 'encrypted-client-config',
        scope: 'com.intuit.quickbooks.accounting openid',
      })
    )
  })

  it('never persists the Intuit identity token', async () => {
    queueTableRows(account, [])
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'intuit-oidc-identity-jwt',
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 8_726_400,
      scope: '',
    })

    await completeQuickBooksConnection.execute({
      principal,
      input: {
        draftId: 'draft-1',
        code: 'authorization-code',
        realmId: '1234567890',
        redirectUri: 'https://sim.test/api/auth/oauth2/callback/quickbooks',
      },
    })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ idToken: null }))
  })

  it('fails before token exchange when the draft does not carry encrypted app credentials', async () => {
    mocks.getActiveDraft.mockResolvedValueOnce({
      id: 'draft-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'quickbooks',
      credentialId: null,
      oauthConfig: null,
    })

    await expect(
      completeQuickBooksConnection.execute({
        principal,
        input: {
          draftId: 'draft-1',
          code: 'authorization-code',
          realmId: '1234567890',
          redirectUri: 'https://sim.test/api/auth/oauth2/callback/quickbooks',
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'QuickBooks OAuth client configuration is missing',
    })
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })
})
