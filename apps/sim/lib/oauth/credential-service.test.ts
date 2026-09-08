/**
 * @vitest-environment node
 */
import { account, credential } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  coalesceLocally: vi.fn(),
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
  decryptQuickBooksOAuthClientConfig: vi.fn(),
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

vi.mock('@/lib/oauth/quickbooks-client-config', () => ({
  decryptQuickBooksOAuthClientConfig: mocks.decryptQuickBooksOAuthClientConfig,
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
  getOAuthToken,
  refreshTokenIfNeeded,
  resolveCredentialTokenBundle,
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

  afterEach(() => {
    vi.useRealTimers()
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

  it('refreshes QuickBooks with its own encrypted app config and rotates both expirations', async () => {
    const now = new Date('2026-09-04T18:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.getRecentTerminalError.mockResolvedValue(null)
    mocks.coalesceLocally.mockImplementation(
      async (_key: string, producer: () => Promise<unknown>) => producer()
    )
    mocks.withLeaderLock.mockImplementation(async (options: { onLeader: () => Promise<unknown> }) =>
      options.onLeader()
    )
    mocks.decryptQuickBooksOAuthClientConfig.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox',
      webhookVerifierToken: 'verifier-token',
    })
    mocks.refreshOAuthToken.mockResolvedValue({
      ok: true,
      accessToken: 'new-access-token',
      expiresIn: 3600,
      refreshToken: 'new-refresh-token',
      refreshTokenExpiresIn: 8_726_400,
    })
    queueTableRows(credential, [
      {
        id: 'credential-1',
        type: 'oauth',
        accountId: 'account-1',
        workspaceId: 'workspace-1',
        providerId: null,
      },
    ])
    queueTableRows(account, [
      {
        id: 'account-1',
        accountId:
          'quickbooks:v2:NkYPLLqX2cM-QABxg0vbv71mQS9s_aRP3v7ZKLvnJyo:sandbox:1234567890:dXNlci0x',
        providerId: 'quickbooks',
        userId: 'user-1',
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
        accessTokenExpiresAt: new Date(now.getTime() - 1),
        refreshTokenExpiresAt: new Date(now.getTime() + 1000),
        oauthConfig: 'encrypted-client-config',
        updatedAt: new Date(0),
      },
    ])

    await expect(
      resolveCredentialTokenBundle('credential-1', 'user-1', 'request-1')
    ).resolves.toEqual({ accessToken: 'new-access-token' })

    expect(mocks.refreshOAuthToken).toHaveBeenCalledWith('quickbooks', 'old-refresh-token', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox',
      webhookVerifierToken: 'verifier-token',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
        refreshTokenExpiresAt: new Date(now.getTime() + 8_726_400_000),
      })
    )
  })
})

describe('non-refreshable OAuth token expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([
    { label: 'expired', expiresAt: new Date(0), usable: false },
    { label: 'unexpired', expiresAt: new Date('2100-01-01'), usable: true },
    { label: 'non-expiring', expiresAt: null, usable: true },
  ])(
    'handles a $label token consistently across credential entry points',
    async ({ expiresAt, usable }) => {
      const row = {
        id: RAW_ACCOUNT_ID,
        accountId: 'google-subject',
        providerId: 'google',
        userId: RAW_USER_ID,
        accessToken: 'fixture-token',
        refreshToken: null,
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: null,
        updatedAt: new Date(0),
      }
      queueTableRows(credential, [
        { id: RAW_CREDENTIAL_ID, type: 'oauth', accountId: RAW_ACCOUNT_ID },
      ])
      queueTableRows(account, [row])
      await expect(
        resolveCredentialTokenBundle(RAW_CREDENTIAL_ID, RAW_USER_ID, 'fixture')
      ).resolves.toEqual(usable ? { accessToken: 'fixture-token' } : null)

      queueTableRows(account, [row])
      await expect(getOAuthToken(RAW_USER_ID, 'google')).resolves.toBe(
        usable ? 'fixture-token' : null
      )

      const refresh = refreshTokenIfNeeded('fixture', row, RAW_ACCOUNT_ID)
      if (usable)
        await expect(refresh).resolves.toEqual({ accessToken: 'fixture-token', refreshed: false })
      else await expect(refresh).rejects.toThrow('reconnect the account')
      expect(mocks.refreshOAuthToken).not.toHaveBeenCalled()
      expect(mocks.coalesceLocally).not.toHaveBeenCalled()
    }
  )
})
