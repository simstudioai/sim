/**
 * @vitest-environment node
 */
import { account, credential } from '@sim/db/schema'
import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  capture: vi.fn(),
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
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { disconnectOAuthUseCase } from '@/lib/credentials/application/oauth-accounts'
import { QuickBooksTokenRevocationError } from '@/lib/oauth/quickbooks'
import { QuickBooksOAuthClientConfigurationError } from '@/lib/oauth/quickbooks-client-config'

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

describe('OAuth account application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
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
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'credential_deleted',
      expect.objectContaining({
        provider_id: 'google-email',
        workspace_id: 'workspace-1',
      }),
      { groups: { workspace: 'workspace-1' } }
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
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

  it('falls back to the QuickBooks access token when no refresh token is stored', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: null,
        oauthConfig: 'encrypted-config',
      },
    ])
    queueTableRows(credential, [])

    await disconnectOAuthUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { provider: 'quickbooks', accountId: 'account-1' },
    })

    expect(mocks.revokeQuickBooksToken).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
      expect.any(AbortSignal)
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
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toMatchObject({ name: 'OAuthDisconnectConfigurationError' })
    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('reports malformed decrypted QuickBooks app configuration as a configuration error', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        oauthConfig: 'invalid-config',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ])
    mocks.decryptClientConfig.mockRejectedValueOnce(
      new QuickBooksOAuthClientConfigurationError('invalid configuration')
    )

    await expect(
      disconnectOAuthUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toMatchObject({ name: 'OAuthDisconnectConfigurationError' })
  })

  it('preserves unexpected QuickBooks decryption infrastructure failures', async () => {
    const deploymentError = new Error('encryption key is unavailable')
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
    mocks.decryptClientConfig.mockRejectedValueOnce(deploymentError)

    await expect(
      disconnectOAuthUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toBe(deploymentError)
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

  it('skips tokenless QuickBooks cleanup when a reconnect wins the account claim', async () => {
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
    queueTableRows(credential, [
      { ...firstCredential, providerId: 'quickbooks', accountId: 'account-1' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      disconnectOAuthUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).resolves.toMatchObject({ success: true, credentials: [] })

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).toHaveBeenCalledWith(account)
    expect(mocks.deleteCredential).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
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
      principal: {
        kind: 'session' as const,
        userId: 'user-1',
        sessionId: 'session-1',
      },
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
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
        input: { provider: 'quickbooks', accountId: 'account-1' },
      })
    ).rejects.toThrow('owns a non-OAuth credential')

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('classifies oversized disconnects without treating them as provider outages', async () => {
    queueTableRows(
      account,
      Array.from({ length: 101 }, (_, index) => ({
        id: `account-${index}`,
        providerId: 'quickbooks',
      }))
    )

    await expect(
      disconnectOAuthUseCase.execute({
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
        },
        input: { provider: 'quickbooks' },
      })
    ).rejects.toMatchObject({
      name: 'OAuthDisconnectLimitError',
      message: 'Too many linked accounts to disconnect in one request',
    })

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
  })

  it('removes a tokenless QuickBooks account without calling Intuit', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'quickbooks',
        accessToken: null,
        refreshToken: null,
      },
    ])
    queueTableRows(credential, [])

    await disconnectOAuthUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { provider: 'quickbooks', accountId: 'account-1' },
    })

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalled()
  })

  it('does not revoke tokens for non-QuickBooks providers', async () => {
    queueTableRows(account, [
      {
        id: 'account-1',
        providerId: 'google-email',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    ])
    queueTableRows(credential, [])

    await disconnectOAuthUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { provider: 'google', accountId: 'account-1' },
    })

    expect(mocks.revokeQuickBooksToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalled()
  })
})
