/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

const CLIENT_CONFIG = {
  clientId: 'quickbooks-client-id',
  clientSecret: 'quickbooks-client-secret',
  environment: 'sandbox' as const,
  webhookVerifierToken: 'quickbooks-webhook-verifier-token',
}

import {
  createQuickBooksAccountId,
  fetchQuickBooksConnectionProfile,
  parseQuickBooksAccountId,
  revokeQuickBooksToken,
} from '@/lib/oauth/quickbooks'
import { deriveQuickBooksWebhookAppKey } from '@/lib/oauth/quickbooks-client-config'

describe('QuickBooks account identity', () => {
  it('round-trips an opaque OpenID subject without narrowing its valid punctuation', () => {
    const accountId = createQuickBooksAccountId('123456789', 'issuer:subject', CLIENT_CONFIG)
    const appKey = deriveQuickBooksWebhookAppKey(CLIENT_CONFIG)

    expect(parseQuickBooksAccountId(accountId)).toEqual({
      appKey,
      realmId: '123456789',
      subject: 'issuer:subject',
      environment: 'sandbox',
    })
  })
})

describe('fetchQuickBooksConnectionProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('binds the documented callback realm to the documented UserInfo identity', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          sub: 'intuit-user-1',
          givenName: 'Ada',
          familyName: 'Lovelace',
          email: 'ada@example.com',
          emailVerified: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Analytical Engines' } })
      )

    const profile = await fetchQuickBooksConnectionProfile(
      'access-token',
      '123456789',
      CLIENT_CONFIG
    )

    expect(profile).toMatchObject({
      realmId: '123456789',
      subject: 'intuit-user-1',
      environment: 'sandbox',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
    })
    const appKey = deriveQuickBooksWebhookAppKey(CLIENT_CONFIG)
    expect(profile.accountId).toBe(`quickbooks:v2:${appKey}:sandbox:123456789:aW50dWl0LXVzZXItMQ`)
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      })
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        href: 'https://sandbox-quickbooks.api.intuit.com/v3/company/123456789/companyinfo/123456789?minorversion=75',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      })
    )
  })

  it('fails closed when the callback company cannot be read with the issued token', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          sub: 'intuit-user-1',
          givenName: 'Ada',
          email: 'ada@example.com',
          emailVerified: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ Fault: { Error: [{ Message: 'AuthenticationFailed' }] } }, { status: 401 })
      )

    await expect(
      fetchQuickBooksConnectionProfile('access-token', '123456789', CLIENT_CONFIG)
    ).rejects.toThrow('QuickBooks company validation failed with HTTP 401')
  })

  it('does not confuse the CompanyInfo entity ID with the OAuth realm ID', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          sub: 'issuer:subject',
          givenName: 'Ada',
          email: 'ada@example.com',
          emailVerified: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Analytical Engines' } })
      )

    await expect(
      fetchQuickBooksConnectionProfile('access-token', '123456789', CLIENT_CONFIG)
    ).resolves.toMatchObject({ realmId: '123456789' })
  })

  it('rejects an unverified Intuit email before reading company data', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        sub: 'intuit-user-1',
        givenName: 'Ada',
        email: 'ada@example.com',
        emailVerified: false,
      })
    )

    await expect(
      fetchQuickBooksConnectionProfile('access-token', '123456789', CLIENT_CONFIG)
    ).rejects.toThrow('QuickBooks UserInfo did not return a verified email address')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('does not treat a truthy string as a verified Intuit email', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        sub: 'intuit-user-1',
        givenName: 'Ada',
        email: 'ada@example.com',
        emailVerified: 'false',
      })
    )

    await expect(
      fetchQuickBooksConnectionProfile('access-token', '123456789', CLIENT_CONFIG)
    ).rejects.toThrow('QuickBooks UserInfo did not return a verified email address')
    expect(mockFetch).toHaveBeenCalledOnce()
  })
})

describe('revokeQuickBooksToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the token to the Intuit revocation endpoint with client authentication', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await expect(revokeQuickBooksToken(' refresh-token ', CLIENT_CONFIG)).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://developer.api.intuit.com/v2/oauth2/tokens/revoke')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(
          'quickbooks-client-id:quickbooks-client-secret'
        ).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: 'refresh-token' }),
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects before sending when client credentials are missing', async () => {
    await expect(
      revokeQuickBooksToken('refresh-token', { ...CLIENT_CONFIG, clientSecret: '' })
    ).rejects.toThrow('QuickBooks client secret must be between 1 and 512 characters')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sanitizes network and timeout failures', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('request timed out', 'AbortError'))

    const result = revokeQuickBooksToken('sensitive-refresh-token', CLIENT_CONFIG)
    await expect(result).rejects.toThrow('QuickBooks token revocation request failed')
    await expect(result).rejects.not.toThrow('sensitive-refresh-token')
  })

  it('fails closed when Intuit rejects the revocation request', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('sensitive-refresh-token quickbooks-client-secret', { status: 400 })
    )

    const result = revokeQuickBooksToken('sensitive-refresh-token', CLIENT_CONFIG)
    await expect(result).rejects.toThrow('QuickBooks token revocation failed with HTTP 400')
    await expect(result).rejects.not.toThrow('sensitive-refresh-token')
    await expect(result).rejects.not.toThrow('quickbooks-client-secret')
  })

  it('marks permanent client failures as non-retryable', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ error: 'invalid_client' }, { status: 400 }))

    await expect(revokeQuickBooksToken('refresh-token', CLIENT_CONFIG)).rejects.toMatchObject({
      name: 'QuickBooksTokenRevocationError',
      status: 400,
      code: 'invalid_client',
      retryable: false,
    })
  })

  it('treats an invalid token response as an already-completed revocation', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ error: 'invalid_token' }, { status: 400 }))

    await expect(revokeQuickBooksToken('refresh-token', CLIENT_CONFIG)).resolves.toBeUndefined()
  })

  it('sanitizes non-terminal non-success responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('sensitive-refresh-token quickbooks-client-secret', { status: 503 })
    )

    const result = revokeQuickBooksToken('sensitive-refresh-token', CLIENT_CONFIG)
    await expect(result).rejects.toThrow('QuickBooks token revocation failed with HTTP 503')
    await expect(result).rejects.not.toThrow('sensitive-refresh-token')
    await expect(result).rejects.not.toThrow('quickbooks-client-secret')
  })

  it('marks rate limits and server failures as retryable', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(revokeQuickBooksToken('refresh-token', CLIENT_CONFIG)).rejects.toMatchObject({
      name: 'QuickBooksTokenRevocationError',
      status: 503,
      retryable: true,
    })
  })
})
