/**
 * @vitest-environment node
 */
import { account, credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  coalesceLocally: vi.fn(),
  clientCredentialMinter: vi.fn(),
  decryptSecret: vi.fn(),
  getFreshestSlackChain: vi.fn(),
  getRecentTerminalError: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
  refreshOAuthToken: vi.fn(),
  withLeaderLock: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mocks.logger),
}))

vi.mock('@/lib/concurrency/singleflight', () => ({
  coalesceLocally: mocks.coalesceLocally,
}))

vi.mock('@/lib/concurrency/leader-lock', () => ({
  withLeaderLock: mocks.withLeaderLock,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mocks.decryptSecret,
}))

vi.mock('@/lib/credentials/client-credential-accounts/server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/credentials/client-credential-accounts/server')>()
  return {
    ...actual,
    getClientCredentialAccountMinter: vi.fn(() => mocks.clientCredentialMinter),
  }
})

vi.mock('@/lib/oauth/instagram', () => ({
  isInstagramProvider: vi.fn(() => false),
  shouldProactivelyRefreshInstagramToken: vi.fn(() => false),
}))

vi.mock('@/lib/oauth/microsoft', () => ({
  getMicrosoftRefreshTokenExpiry: vi.fn(),
  isMicrosoftProvider: vi.fn(() => false),
  PROACTIVE_REFRESH_THRESHOLD_DAYS: 7,
}))

vi.mock('@/lib/oauth/oauth', () => ({
  OAUTH_PROVIDERS: {},
  refreshOAuthToken: mocks.refreshOAuthToken,
}))

vi.mock('@/lib/oauth/slack', () => ({
  extractSlackTeamId: (value: string | null | undefined) =>
    value?.match(/^([TE][A-Z0-9]+)-/)?.[1] ?? null,
  fanOutSlackTokenChain: vi.fn(),
  getFreshestSlackChain: mocks.getFreshestSlackChain,
  hasSlackChainMoved: vi.fn(() => false),
  isSlackProvider: (providerId: string) => providerId === 'slack',
}))

vi.mock('@/lib/oauth/terminal-errors', () => ({
  getRecentTerminalError: mocks.getRecentTerminalError,
  isTerminalRefreshError: vi.fn(() => false),
  markCredentialDead: vi.fn(),
}))

import {
  resolveCredentialTokenBundle,
  resolveServiceAccountToken,
} from '@/lib/oauth/credential-service'

const RAW_CREDENTIAL_ID = 'credential-raw-secret-id'
const RAW_ACCOUNT_ID = 'account-raw-secret-id'
const RAW_USER_ID = 'user-raw-secret-id'
const RAW_SLACK_TEAM_ID = 'TSECRET123'
const RAW_PROVIDER_ERROR = 'provider returned raw private failure text'

interface RefreshObservation {
  cacheKey: string
  coalescingKey: string
  lockKey: string
  logs: string
}

async function observeRefresh(
  providerId: 'google' | 'slack',
  privacyMode?: 'selector'
): Promise<RefreshObservation> {
  resetDbChainMock()
  vi.clearAllMocks()
  mocks.getRecentTerminalError.mockResolvedValue(null)
  mocks.coalesceLocally.mockImplementation(async (_key: string, producer: () => Promise<unknown>) =>
    producer()
  )
  mocks.withLeaderLock.mockImplementation(async (options: { onLeader: () => Promise<unknown> }) =>
    options.onLeader()
  )
  mocks.getFreshestSlackChain.mockResolvedValue({
    accessToken: null,
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(0),
    chainVersion: new Date(0),
  })
  mocks.refreshOAuthToken.mockRejectedValue(new Error(RAW_PROVIDER_ERROR))

  queueTableRows(credential, [
    {
      id: RAW_CREDENTIAL_ID,
      type: 'oauth',
      accountId: RAW_ACCOUNT_ID,
      workspaceId: 'workspace-1',
      providerId: null,
    },
  ])
  queueTableRows(account, [
    {
      id: RAW_ACCOUNT_ID,
      accountId:
        providerId === 'slack'
          ? `${RAW_SLACK_TEAM_ID}-usr_USECRET-connection`
          : 'provider-account-id',
      providerId,
      userId: RAW_USER_ID,
      accessToken: null,
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: new Date(0),
      refreshTokenExpiresAt: null,
      updatedAt: new Date(0),
    },
  ])

  await expect(
    resolveCredentialTokenBundle(
      RAW_CREDENTIAL_ID,
      RAW_USER_ID,
      'selector-execution',
      undefined,
      undefined,
      privacyMode ? { privacyMode } : undefined
    )
  ).resolves.toBeNull()

  return {
    cacheKey: mocks.getRecentTerminalError.mock.calls[0][0],
    coalescingKey: mocks.coalesceLocally.mock.calls[0][0],
    lockKey: mocks.withLeaderLock.mock.calls[0][0].key,
    logs: JSON.stringify([
      ...mocks.logger.info.mock.calls,
      ...mocks.logger.warn.mock.calls,
      ...mocks.logger.error.mock.calls,
    ]),
  }
}

describe('resolveCredentialTokenBundle selector privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('HMACs OAuth and Slack refresh identities and suppresses raw identifiers and provider errors', async () => {
    for (const providerId of ['google', 'slack'] as const) {
      const observed = await observeRefresh(providerId, 'selector')
      const serializedKeys = JSON.stringify([
        observed.cacheKey,
        observed.coalescingKey,
        observed.lockKey,
      ])

      expect(observed.coalescingKey).toBe(observed.lockKey)
      expect(observed.coalescingKey).toMatch(/^oauth:refresh:[A-Za-z0-9_-]{40,}$/)
      for (const privateValue of [
        RAW_CREDENTIAL_ID,
        RAW_ACCOUNT_ID,
        RAW_USER_ID,
        RAW_SLACK_TEAM_ID,
        RAW_PROVIDER_ERROR,
      ]) {
        expect(serializedKeys).not.toContain(privateValue)
        expect(observed.logs).not.toContain(privateValue)
      }
    }
  })

  it('shares private refresh coordination across privacy modes without changing ordinary diagnostics', async () => {
    const privateGoogle = await observeRefresh('google', 'selector')
    const google = await observeRefresh('google')
    expect(google.cacheKey).toBe(privateGoogle.cacheKey)
    expect(google.coalescingKey).toBe(privateGoogle.coalescingKey)
    expect(google.lockKey).toBe(google.coalescingKey)
    expect(google.coalescingKey).not.toContain(RAW_ACCOUNT_ID)
    expect(google.logs).toContain(RAW_ACCOUNT_ID)
    expect(google.logs).toContain(RAW_USER_ID)
    expect(google.logs).toContain(RAW_PROVIDER_ERROR)

    const privateSlack = await observeRefresh('slack', 'selector')
    const slack = await observeRefresh('slack')
    expect(slack.cacheKey).toBe(privateSlack.cacheKey)
    expect(slack.coalescingKey).toBe(privateSlack.coalescingKey)
    expect(slack.lockKey).toBe(slack.coalescingKey)
    expect(slack.coalescingKey).not.toContain(RAW_SLACK_TEAM_ID)
    expect(slack.logs).toContain(RAW_SLACK_TEAM_ID)
    expect(slack.logs).toContain(RAW_PROVIDER_ERROR)
  })
})

describe('Oracle EPM client-credential token cache', () => {
  const providerId = 'oracle-epm-service-account'
  const blob = JSON.stringify({
    type: 'client_credential_account',
    providerId,
    clientId: 'integration.user@example.com',
    clientSecret: 'password',
    orgId: 'https://epm.example.com',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.coalesceLocally.mockImplementation(
      async (_key: string, producer: () => Promise<unknown>) => producer()
    )
    mocks.decryptSecret.mockResolvedValue({ decrypted: blob })
  })

  it('reuses the conservative synthetic token while its safety window remains', async () => {
    const credentialId = 'oracle-epm-cache-credential'
    const encrypted = 'cache-secret-fingerprint-000000000000000000000000000000000'
    queueTableRows(credential, [{ encryptedServiceAccountKey: encrypted }])
    queueTableRows(credential, [{ encryptedServiceAccountKey: encrypted }])
    mocks.clientCredentialMinter.mockResolvedValue({
      accessToken: 'basic-token',
      expiresInSeconds: 600,
      instanceUrl: 'https://epm.example.com',
    })

    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: 'basic-token',
    })
    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: 'basic-token',
    })
    expect(mocks.clientCredentialMinter).toHaveBeenCalledTimes(1)
  })

  it('invalidates the cached token immediately when encrypted credentials rotate', async () => {
    const credentialId = 'oracle-epm-rotation-credential'
    queueTableRows(credential, [
      { encryptedServiceAccountKey: 'old-secret-fingerprint-000000000000000000000000000000000' },
    ])
    queueTableRows(credential, [
      { encryptedServiceAccountKey: 'new-secret-fingerprint-000000000000000000000000000000000' },
    ])
    mocks.clientCredentialMinter
      .mockResolvedValueOnce({ accessToken: 'old-token', expiresInSeconds: 600 })
      .mockResolvedValueOnce({ accessToken: 'new-token', expiresInSeconds: 600 })

    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: 'old-token',
    })
    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: 'new-token',
    })
    expect(mocks.clientCredentialMinter).toHaveBeenCalledTimes(2)
  })
})
