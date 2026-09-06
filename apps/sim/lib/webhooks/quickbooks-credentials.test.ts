/** @vitest-environment node */

import { account, credential } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret } = vi.hoisted(() => ({ mockDecryptSecret: vi.fn() }))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: vi.fn(),
}))

import { createQuickBooksAccountId } from '@/lib/oauth/quickbooks'
import {
  deriveQuickBooksWebhookAppKey,
  type QuickBooksOAuthClientConfig,
} from '@/lib/oauth/quickbooks-client-config'
import {
  buildQuickBooksWebhookAccountIdPattern,
  buildQuickBooksWebhookRoutingKey,
  getQuickBooksWebhookClientConfigByCredentialId,
  streamQuickBooksWebhookVerifierTokensByAppKey,
} from '@/lib/webhooks/quickbooks-credentials'

async function collectVerifierTokens(appKey: string): Promise<string[]> {
  const tokens: string[] = []
  for await (const token of streamQuickBooksWebhookVerifierTokensByAppKey(appKey)) {
    tokens.push(token)
  }
  return tokens
}

const CLIENT_CONFIG: QuickBooksOAuthClientConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  environment: 'sandbox',
  webhookVerifierToken: 'verifier-token',
}
const APP_KEY = deriveQuickBooksWebhookAppKey(CLIENT_CONFIG)
const ACCOUNT_ID = createQuickBooksAccountId('1234567890', 'subject-1', CLIENT_CONFIG)

describe('QuickBooks webhook credential lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(CLIENT_CONFIG) })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('loads and validates an app-scoped verifier token', async () => {
    queueTableRows(account, [
      {
        accountId: ACCOUNT_ID,
        oauthConfig: 'encrypted-config',
      },
    ])

    await expect(collectVerifierTokens(APP_KEY)).resolves.toEqual(['verifier-token'])
    expect(mockDecryptSecret).toHaveBeenCalledWith('encrypted-config')
  })

  it('returns every distinct verifier token for accounts that share one Intuit app', async () => {
    queueTableRows(account, [
      { accountId: ACCOUNT_ID, oauthConfig: 'first-config' },
      {
        accountId: createQuickBooksAccountId('9876543210', 'subject-2', CLIENT_CONFIG),
        oauthConfig: 'second-config',
      },
    ])
    mockDecryptSecret
      .mockResolvedValueOnce({
        decrypted: JSON.stringify({ ...CLIENT_CONFIG, webhookVerifierToken: 'first-verifier' }),
      })
      .mockResolvedValueOnce({
        decrypted: JSON.stringify({ ...CLIENT_CONFIG, webhookVerifierToken: 'second-verifier' }),
      })

    await expect(collectVerifierTokens(APP_KEY)).resolves.toEqual([
      'first-verifier',
      'second-verifier',
    ])
  })

  it('decrypts one account at a time so an early match skips the rest of the app', async () => {
    queueTableRows(
      account,
      Array.from({ length: 10 }, (_, index) => ({
        accountId: createQuickBooksAccountId(String(index + 1), `subject-${index}`, CLIENT_CONFIG),
        oauthConfig: 'encrypted-config',
      }))
    )

    for await (const token of streamQuickBooksWebhookVerifierTokensByAppKey(APP_KEY)) {
      expect(token).toBe('verifier-token')
      break
    }

    expect(mockDecryptSecret).toHaveBeenCalledTimes(1)
  })

  it('fails closed instead of loading an unbounded number of app accounts', async () => {
    queueTableRows(
      account,
      Array.from({ length: 1001 }, (_, index) => ({
        accountId: createQuickBooksAccountId(String(index + 1), `subject-${index}`, CLIENT_CONFIG),
        oauthConfig: 'encrypted-config',
      }))
    )

    await expect(collectVerifierTokens(APP_KEY)).rejects.toThrow(
      'QuickBooks webhook app account limit exceeded'
    )
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1001)
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('binds a deployed credential to the same app and company identity', async () => {
    queueTableRows(account, [
      {
        accountId: ACCOUNT_ID,
        oauthConfig: 'encrypted-config',
      },
    ])

    await expect(getQuickBooksWebhookClientConfigByCredentialId('credential-1')).resolves.toEqual({
      clientConfig: CLIENT_CONFIG,
      identity: {
        appKey: APP_KEY,
        environment: 'sandbox',
        realmId: '1234567890',
        subject: 'subject-1',
      },
    })
    expect(dbChainMockFns.from).toHaveBeenCalledWith(credential)
    expect(dbChainMockFns.innerJoin).toHaveBeenCalledWith(account, expect.anything())
    expect(dbChainMockFns.where).toHaveBeenCalled()
  })

  it('fails closed when the encrypted config does not match the addressed app', async () => {
    queueTableRows(account, [
      {
        accountId: ACCOUNT_ID,
        oauthConfig: 'encrypted-config',
      },
    ])
    mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({ ...CLIENT_CONFIG, clientId: 'different-app' }),
    })

    await expect(collectVerifierTokens(APP_KEY)).resolves.toEqual([])
  })

  it('escapes wildcard characters in the app-scoped account lookup', async () => {
    const appKeyWithUnderscore = `${'_'.repeat(42)}A`

    expect(buildQuickBooksWebhookAccountIdPattern(appKeyWithUnderscore)).toBe(
      `quickbooks:v2:${'\\_'.repeat(42)}A:%`
    )
  })

  it('constructs an app-and-company routing key and rejects malformed app keys', () => {
    expect(buildQuickBooksWebhookRoutingKey(APP_KEY, ' 1234567890 ')).toBe(`${APP_KEY}:1234567890`)
    expect(() => buildQuickBooksWebhookRoutingKey('invalid', '1234567890')).toThrow(
      'QuickBooks webhook app key is invalid'
    )
  })
})
