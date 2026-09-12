/** @vitest-environment node */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { findAccount, updateAccount, processDraft } = vi.hoisted(() => ({
  findAccount: vi.fn(),
  updateAccount: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  processDraft: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    query: { account: { findFirst: findAccount } },
    update: () => ({ set: updateAccount }),
  },
}))
vi.mock('@/lib/credentials/draft-processor', () => ({ processCredentialDraft: processDraft }))
vi.mock('@/lib/oauth/credential-service', () => ({ safeAccountInsert: vi.fn() }))

import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { createGitHubRepositoriesProvider } from '@/lib/oauth/github-repositories'
import { exchangeMondayAuthorizationCode } from '@/lib/oauth/monday'
import { revokeQuickBooksToken } from '@/lib/oauth/quickbooks'
import { completeShopifyOAuthConnection } from '@/lib/oauth/shopify'

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}

describe('OAuth account lifecycle networking', () => {
  beforeAll(async () => {
    setEnv({
      OUTBOUND_ROUTING_SOURCE: 'env',
      OUTBOUND_ROUTING_CONFIG: JSON.stringify({
        schemaVersion: 1,
        revision: 'test',
        defaultRoute: { kind: 'direct' },
        organizations: {},
      }),
    })
    await expect(resolveCurrentOutboundRoute()).rejects.toThrow('MISSING_SCOPE')
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => vi.unstubAllGlobals())
  afterAll(resetEnvMock)

  it('completes GitHub code exchange and identity verification without a resource scope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          access_token: 'ghu_access',
          refresh_token: 'ghr_refresh',
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: 'bearer',
          scope: '',
        })
      )
      .mockResolvedValueOnce(json({ id: 1234, login: 'octocat', type: 'User', name: 'Octocat' }))
      .mockResolvedValueOnce(json([{ email: 'user@example.com', primary: true, verified: true }]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = createGitHubRepositoriesProvider({
      clientId: 'app-client',
      clientSecret: 'app-secret',
      redirectURI: 'https://sim.example/callback',
    })
    const tokens = await provider.getToken!({
      code: 'code',
      codeVerifier: 'verifier',
      redirectURI: 'https://sim.example/callback',
    })
    await expect(provider.getUserInfo!(tokens)).resolves.toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('completes Monday code exchange without a resource scope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          access_token: 'monday-access-token',
          refresh_token: 'monday-refresh-token',
          token_type: 'Bearer',
          scope: 'me:read',
          expires_in: 3600,
        })
      )
    )
    await expect(
      exchangeMondayAuthorizationCode({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        code: 'code',
        codeVerifier: 'verifier',
        redirectUri: 'https://sim.example/callback',
      })
    ).resolves.toMatchObject({
      accessToken: 'monday-access-token',
      refreshToken: 'monday-refresh-token',
    })
  })

  it('revokes a user-owned QuickBooks account without inventing a resource scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      revokeQuickBooksToken('refresh-token', {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        environment: 'sandbox',
        webhookVerifierToken: 'webhook-verifier',
      })
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'refresh-token' }) })
    )
  })

  it('validates Shopify and completes its exact draft without a resource scope', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn().mockResolvedValue(json({ shop: { id: 42 } }))
    vi.stubGlobal('fetch', fetchMock)
    findAccount.mockResolvedValue({ id: 'existing-account' })
    await completeShopifyOAuthConnection({
      accessToken: 'shopify-access-token',
      shopDomain: 'example.myshopify.com',
      userId: 'user-1',
      draftId: 'draft-from-state',
      signal,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('example.myshopify.com/admin/api/'),
      expect.objectContaining({ signal })
    )
    expect(processDraft).toHaveBeenCalledWith({
      draftId: 'draft-from-state',
      userId: 'user-1',
      providerId: 'shopify',
      accountId: 'existing-account',
    })
  })
})
