import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintGreenhouseServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/greenhouse'

const FIELDS = { clientId: 'greenhouse-client', clientSecret: 'greenhouse-secret', orgId: '' }

const mockFetch = vi.fn<typeof fetch>()

describe('Greenhouse client credential exchange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('exchanges the credential with a scope-free client credentials grant', async () => {
    const requests: Request[] = []
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      expect(request.url).toBe('https://auth.greenhouse.io/token')
      expect(request.method).toBe('POST')
      expect(request.redirect).toBe('error')
      const [scheme, encodedCredentials = ''] = (request.headers.get('authorization') ?? '').split(
        ' '
      )
      expect(scheme).toBe('Basic')
      expect(Buffer.from(encodedCredentials, 'base64').toString('utf8')).toBe(
        'greenhouse-client:greenhouse-secret'
      )
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect([...new URLSearchParams(await request.text())]).toEqual([
        ['grant_type', 'client_credentials'],
      ])
      return jsonResponse({
        access_token: 'greenhouse-access',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    })

    const result = await mintGreenhouseServiceAccountToken(FIELDS)

    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ accessToken: 'greenhouse-access', expiresInSeconds: 3600 })
    expect(result.identity).toMatchObject({
      principal: null,
      auditMetadata: { greenhouseClientId: 'greenhouse-client' },
    })
    expect(JSON.stringify(result.identity)).not.toContain(FIELDS.clientSecret)
    expect(JSON.stringify(result.identity)).not.toContain('greenhouse-access')
  })

  it.each([
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'denied' }, { status }))

    await expect(mintGreenhouseServiceAccountToken(FIELDS)).rejects.toMatchObject({ code, status })
  })

  it.each([
    ['no access token', { token_type: 'Bearer', expires_in: 3600 }],
    ['a blank access token', { access_token: ' ', expires_in: 3600 }],
    ['no lifetime', { access_token: 'greenhouse-access' }],
    ['a non-positive lifetime', { access_token: 'greenhouse-access', expires_in: 0 }],
    ['a fractional lifetime', { access_token: 'greenhouse-access', expires_in: 1.5 }],
  ])('refuses a token response with %s', async (_label, body) => {
    mockFetch.mockResolvedValue(jsonResponse(body))

    await expect(mintGreenhouseServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('refuses an oversized token response', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'x'.repeat(70 * 1024), expires_in: 3600 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(mintGreenhouseServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('never sends a request without a client secret', async () => {
    await expect(
      mintGreenhouseServiceAccountToken({ ...FIELDS, clientSecret: undefined })
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 400 })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
