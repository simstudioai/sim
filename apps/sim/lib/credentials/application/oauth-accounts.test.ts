import { account, credential } from '@sim/db/schema'
import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  revokeQuickBooksToken: vi.fn(),
  decryptClientConfig: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/credentials/orchestration', () => ({
  deleteCredentialRecord: mocks.deleteCredential,
}))
vi.mock('@/lib/oauth/quickbooks', () => ({
  revokeQuickBooksToken: mocks.revokeQuickBooksToken,
  QuickBooksTokenRevocationError: class QuickBooksTokenRevocationError extends Error {
    readonly retryable: boolean

    constructor(readonly status: number) {
      super(`QuickBooks token revocation failed with HTTP ${status}`)
      this.name = 'QuickBooksTokenRevocationError'
      this.retryable = status === 429 || status >= 500
    }
  },
}))
vi.mock('@/lib/oauth/quickbooks-client-config', () => ({
  decryptQuickBooksOAuthClientConfig: mocks.decryptClientConfig,
  QuickBooksOAuthClientConfigurationError: class QuickBooksOAuthClientConfigurationError extends Error {},
}))
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { disconnectOAuthUseCase } from '@/lib/credentials/application/oauth-accounts'
import { QuickBooksTokenRevocationError } from '@/lib/oauth/quickbooks'

const firstCredential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'oauth' as const,
  displayName: 'First Google account',
  description: null,
  providerId: 'google-email',
  accountId: 'account-1',
  envKey: null,
  envOwnerUserId: null,
  encryptedServiceAccountKey: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}

const PRINCIPAL = createSessionPrincipal()

describe('OAuth account application operations', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.revokeQuickBooksToken.mockResolvedValue(undefined)
    mocks.decryptClientConfig.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox',
      webhookVerifierToken: 'verifier-token',
    })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'account-1' }])
  })

  it('audits and captures committed deletions before rethrowing a later failure', async () => {
    const secondCredential = {
      ...firstCredential,
      id: 'credential-2',
      displayName: 'Second Google account',
      accountId: 'account-2',
    }
    queueTableRows(account, [{ id: 'account-1' }, { id: 'account-2' }])
    queueTableRows(credential, [firstCredential, secondCredential])
    mocks.deleteCredential
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Second credential delete failed'))

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'google' },
      })
    ).rejects.toMatchObject({
      name: 'OAuthDisconnectPartialFailureError',
      credentials: [firstCredential],
    })

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'credential.deleted',
        resourceId: firstCredential.id,
        metadata: expect.objectContaining({ reason: 'oauth_disconnect' }),
      })
    )
  })

  it('revokes the QuickBooks refresh token before deleting the local account', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'encrypted-config',
      },
    ])
    queueTableRows(credential, [])

    await disconnectOAuthUseCase.execute({
      principal: PRINCIPAL,
      input: { provider: 'quickbooks', accountId: 'account-1' },
    })

    expect(mocks.revokeQuickBooksToken).toHaveBeenCalledWith(
      'refresh-token',
      expect.objectContaining({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
      expect.any(AbortSignal)
    )
    expect(dbChainMockFns.delete).toHaveBeenCalled()
    expect(mocks.revokeQuickBooksToken.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[0]
    )
  })

  it('keeps QuickBooks credentials locally when Intuit revocation fails', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'encrypted-config',
      },
    ])
    mocks.revokeQuickBooksToken.mockRejectedValueOnce(new Error('Intuit unavailable'))

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toMatchObject({
      name: 'OAuthProviderRevocationError',
      message: 'Unable to revoke QuickBooks access. Please try again.',
    })

    expect(mocks.deleteCredential).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('reports missing QuickBooks app configuration as a non-retryable configuration error', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: null,
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ])

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toMatchObject({ name: 'OAuthDisconnectConfigurationError' })
    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('reports a permanent Intuit revocation rejection as a configuration error', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'encrypted-config',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ])
    mocks.revokeQuickBooksToken.mockRejectedValueOnce(new QuickBooksTokenRevocationError(400))

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toMatchObject({ name: 'OAuthDisconnectConfigurationError' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('skips local cleanup when the QuickBooks account changed during revocation', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'encrypted-config',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ])
    queueTableRows(credential, [
      { ...firstCredential, providerId: 'quickbooks', accountId: 'account-1' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).resolves.toMatchObject({ success: true, credentials: [] })

    expect(mocks.deleteCredential).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('claims a tokenless QuickBooks account before deleting local credentials', async () => {
    const linkedCredential = {
      ...firstCredential,
      providerId: 'quickbooks',
      accountId: 'account-1',
    }
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: null,
        refreshToken: null,
        oauthConfig: 'encrypted-config',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ])
    queueTableRows(credential, [linkedCredential])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'account-1' }])
    mocks.deleteCredential.mockResolvedValueOnce(true)

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).resolves.toMatchObject({ success: true, credentials: [linkedCredential] })

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledWith(account)
    expect(mocks.deleteCredential).toHaveBeenCalledWith({
      credential: linkedCredential,
      reason: 'oauth_disconnect',
    })
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(account)
  })

  it('records a successful Intuit revocation so a local-delete retry does not revoke twice', async () => {
    const linkedCredential = {
      ...firstCredential,
      providerId: 'quickbooks',
      accountId: 'account-1',
    }
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'encrypted-config',
      },
    ])
    queueTableRows(credential, [linkedCredential])
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: null,
        refreshToken: null,
        oauthConfig: 'encrypted-config',
      },
    ])
    queueTableRows(credential, [linkedCredential])
    mocks.deleteCredential
      .mockRejectedValueOnce(new Error('Local delete failed'))
      .mockResolvedValueOnce(true)

    const input = {
      principal: PRINCIPAL,
      input: { provider: 'quickbooks', accountId: 'account-1' },
    }
    await expect(disconnectOAuthUseCase.execute(input)).rejects.toThrow('Local delete failed')
    await expect(disconnectOAuthUseCase.execute(input)).resolves.toMatchObject({
      success: true,
    })

    expect(mocks.revokeQuickBooksToken).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      })
    )
  })

  it('validates every linked credential before revoking QuickBooks access', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'encrypted-config',
      },
    ])
    queueTableRows(credential, [
      {
        ...firstCredential,
        type: 'service_account',
        providerId: 'quickbooks',
        accountId: 'account-1',
      },
    ])

    await expect(
      disconnectOAuthUseCase.execute({
        principal: PRINCIPAL,
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toThrow('owns a non-OAuth credential')

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
