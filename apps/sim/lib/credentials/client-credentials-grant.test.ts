import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeClientCredentialsGrant } from '@/lib/credentials/client-credentials-grant'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const mockFetch = vi.fn<typeof fetch>()

const REQUEST = {
  url: 'https://auth.example.com/oauth/token',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  step: 'example_token_mint',
  label: 'Example token response',
  maxLifetimeSeconds: 3600,
}

describe('exchangeClientCredentialsGrant', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('posts the client credentials and extra fields as a form, refusing redirects', async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      expect(request.url).toBe(REQUEST.url)
      expect(request.method).toBe('POST')
      expect(request.redirect).toBe('error')
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect([...new URLSearchParams(await request.text())]).toEqual([
        ['grant_type', 'client_credentials'],
        ['client_id', 'client-1'],
        ['client_secret', 'secret-1'],
        ['scope', 'read'],
      ])
      return jsonResponse({ access_token: 'token-1', expires_in: 1800 })
    })

    const startedAt = Date.now()
    const exchanged = await exchangeClientCredentialsGrant({
      ...REQUEST,
      extraFields: { scope: 'read' },
    })

    expect(exchanged.accessToken).toBe('token-1')
    expect(exchanged.expiresAt.getTime() - startedAt).toBeGreaterThanOrEqual(1800 * 1000 - 50)
    expect(exchanged.expiresAt.getTime() - startedAt).toBeLessThanOrEqual(1800 * 1000 + 50)
  })

  it('never keeps a token longer than the lifetime cap', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: 'token-1', expires_in: 9_999_999 }))

    const startedAt = Date.now()
    const exchanged = await exchangeClientCredentialsGrant(REQUEST)

    expect(exchanged.expiresAt.getTime() - startedAt).toBeLessThanOrEqual(3600 * 1000 + 50)
  })

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [408, 'provider_unavailable'],
    [429, 'provider_unavailable'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'invalid_client' }, { status }))

    await expect(exchangeClientCredentialsGrant(REQUEST)).rejects.toMatchObject({ code, status })
  })

  it("throws the provider's own classification of a refusal", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'org_mismatch' }, { status: 400 }))
    const classifyRefusal = vi.fn(
      (status: number, body: string) =>
        new TokenServiceAccountValidationError('grant_not_permitted', status, {
          step: REQUEST.step,
          reason: body.includes('org_mismatch') ? 'org mismatch' : 'other',
        })
    )

    await expect(
      exchangeClientCredentialsGrant({ ...REQUEST, classifyRefusal })
    ).rejects.toMatchObject({ code: 'grant_not_permitted', status: 400 })
    expect(classifyRefusal).toHaveBeenCalledWith(400, expect.stringContaining('org_mismatch'))
  })

  it.each([
    ['no access token', { expires_in: 3600 }],
    ['a blank access token', { access_token: ' ', expires_in: 3600 }],
    ['no lifetime', { access_token: 'token-1' }],
    ['a fractional lifetime', { access_token: 'token-1', expires_in: 1.5 }],
    ['a non-positive lifetime', { access_token: 'token-1', expires_in: 0 }],
  ])('refuses a token response with %s', async (_label, body) => {
    mockFetch.mockResolvedValue(jsonResponse(body))

    await expect(exchangeClientCredentialsGrant(REQUEST)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('refuses a token response that is not JSON', async () => {
    mockFetch.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }))

    await expect(exchangeClientCredentialsGrant(REQUEST)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
