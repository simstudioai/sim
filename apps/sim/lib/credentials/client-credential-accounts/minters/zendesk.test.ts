import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintZendeskServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zendesk'

const CLIENT = {
  authMethod: 'client_credentials',
  orgId: 'https://Acme.zendesk.com/',
  clientId: 'sim_client',
  clientSecret: 'client-secret',
  scope: 'read write',
}

const API_TOKEN = {
  authMethod: 'api_token',
  orgId: 'acme',
  clientId: '',
  username: 'agent@example.com',
  apiToken: 'zendesk-api-token',
}

const AGENT = { user: { id: 42, role: 'agent', email: 'agent@example.com', name: 'Agent' } }

const mockFetch = vi.fn<typeof fetch>()

function requestOf(call: number): Request {
  const [input, init] = mockFetch.mock.calls[call]
  return new Request(input, init)
}

describe('Zendesk credential minting', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('exchanges an OAuth client for a bearer token on the account subdomain only', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'bearer-1', token_type: 'bearer', scope: 'read write' })
      )
      .mockResolvedValueOnce(jsonResponse(AGENT))

    const result = await mintZendeskServiceAccountToken(CLIENT)

    const exchange = requestOf(0)
    expect(exchange.url).toBe('https://acme.zendesk.com/oauth/tokens')
    expect(exchange.method).toBe('POST')
    expect(exchange.redirect).toBe('error')
    expect(exchange.headers.get('content-type')).toBe('application/json')
    expect(await exchange.json()).toEqual({
      grant_type: 'client_credentials',
      client_id: 'sim_client',
      client_secret: 'client-secret',
      scope: 'read write',
      expires_in: 3600,
    })
    const me = requestOf(1)
    expect(me.url).toBe('https://acme.zendesk.com/api/v2/users/me.json')
    expect(me.headers.get('authorization')).toBe('Bearer bearer-1')
    expect(me.redirect).toBe('error')
    expect(result).toMatchObject({
      accessToken: 'bearer-1',
      expiresInSeconds: 3600,
      domain: 'acme',
      identity: { principal: { kind: 'user', id: '42' } },
    })
    expect(result.authStyle).toBeUndefined()
    expect(JSON.stringify(result.identity)).not.toContain('client-secret')
  })

  it('never keeps a token longer than the lifetime Sim requested', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'bearer-1', expires_in: 172800 }))

    const result = await mintZendeskServiceAccountToken(CLIENT, { skipIdentity: true })

    expect(result.expiresInSeconds).toBe(3600)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('derives the documented email/token Basic credential without calling Zendesk at run time', async () => {
    const result = await mintZendeskServiceAccountToken(API_TOKEN, { skipIdentity: true })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.authStyle).toBe('basic')
    expect(result.domain).toBe('acme')
    expect(Buffer.from(result.accessToken, 'base64').toString('utf8')).toBe(
      'agent@example.com/token:zendesk-api-token'
    )
  })

  it('verifies an API token sign-in with the same Basic header the tools send', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(AGENT))

    const result = await mintZendeskServiceAccountToken(API_TOKEN)

    expect(requestOf(0).headers.get('authorization')).toBe(`Basic ${result.accessToken}`)
    expect(result.identity?.principal).toMatchObject({ kind: 'user', id: '42' })
  })

  it.each([
    ['an anonymous user', { user: { id: null, role: 'end-user', name: 'Anonymous user' } }],
    ['an end user', { user: { id: 7, role: 'end-user' } }],
    ['no user', {}],
  ])('refuses a credential that signs in as %s', async (_label, body) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(body))

    await expect(mintZendeskServiceAccountToken(API_TOKEN)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it.each([
    'acme.zendesk.com.evil.example',
    'evil.example/acme',
    'acme.other',
    '-acme',
    'localhost:8080',
    '',
  ])('refuses the subdomain %j before any request', async (orgId) => {
    await expect(mintZendeskServiceAccountToken({ ...CLIENT, orgId })).rejects.toMatchObject({
      code: 'site_not_found',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['no scope', { scope: undefined }],
    ['an unknown scope', { scope: 'impersonate' }],
    ['no client secret', { clientSecret: undefined }],
  ])('never requests a token with %s', async (_label, override) => {
    await expect(mintZendeskServiceAccountToken({ ...CLIENT, ...override })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('never signs in with an API token missing its agent email', async () => {
    await expect(
      mintZendeskServiceAccountToken({ ...API_TOKEN, username: ' ' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'invalid_credentials'],
    [400, 'invalid_credentials'],
    [404, 'site_not_found'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, { status }))

    await expect(mintZendeskServiceAccountToken(CLIENT)).rejects.toMatchObject({ code })
  })

  it("carries the token endpoint's Retry-After on a throttled answer", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'busy' }, { status: 429, headers: { 'Retry-After': '7' } })
    )

    await expect(mintZendeskServiceAccountToken(CLIENT)).rejects.toMatchObject({
      code: 'provider_unavailable',
      retryAfterMs: 7_000,
    })
  })

  it('refuses a token response without an access token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ token_type: 'bearer' }))

    await expect(mintZendeskServiceAccountToken(CLIENT)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
