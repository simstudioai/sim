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

vi.mock('@/lib/credentials/client-credential-accounts/server', () => ({
  getClientCredentialAccountMinter: () => mocks.clientCredentialMinter,
  parseClientCredentialAccountSecretBlob: (decrypted: string) => JSON.parse(decrypted),
}))

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

describe('resolveServiceAccountToken Oracle Fusion cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.coalesceLocally.mockImplementation(
      async (_key: string, producer: () => Promise<unknown>) => producer()
    )
    mocks.decryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: JSON.stringify({
        type: 'client_credential_account',
        providerId: 'oracle-fusion-service-account',
        clientId: 'integration-user',
        clientSecret: encrypted,
        orgId: 'https://vision.fa.us2.oraclecloud.com',
      }),
    }))
    mocks.clientCredentialMinter.mockImplementation(async (fields: { clientSecret: string }) => ({
      accessToken: `basic-${fields.clientSecret}`,
      expiresInSeconds: 300,
      instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
    }))
  })

  it('reuses Basic material for five minutes and invalidates it on encrypted-secret rotation', async () => {
    const credentialId = 'oracle-fusion-cache-test'
    const providerId = 'oracle-fusion-service-account'
    const encryptedV1 = 'encrypted-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const encryptedV2 = 'encrypted-v2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    queueTableRows(credential, [{ encryptedServiceAccountKey: encryptedV1 }])
    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: `basic-${encryptedV1}`,
    })

    queueTableRows(credential, [{ encryptedServiceAccountKey: encryptedV1 }])
    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: `basic-${encryptedV1}`,
    })
    expect(mocks.clientCredentialMinter).toHaveBeenCalledTimes(1)

    queueTableRows(credential, [{ encryptedServiceAccountKey: encryptedV2 }])
    await expect(resolveServiceAccountToken(credentialId, providerId)).resolves.toMatchObject({
      accessToken: `basic-${encryptedV2}`,
    })
    expect(mocks.clientCredentialMinter).toHaveBeenCalledTimes(2)
  })
})
