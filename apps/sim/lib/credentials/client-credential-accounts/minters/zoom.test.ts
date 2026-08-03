/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintZoomServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoom'

const TOKEN_URL = 'https://zoom.us/oauth/token'

const FIELDS = { clientId: 'zoom-cid', clientSecret: 'zoom-secret', orgId: 'AbCdEf123' }

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function htmlResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON')
    },
    text: async () => body,
  } as unknown as Response
}

const mockFetch = vi.fn()

function expectMintCall(): void {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(TOKEN_URL)
  expect(init.method).toBe('POST')
  expect(init.headers.Authorization).toBe(
    `Basic ${Buffer.from('zoom-cid:zoom-secret').toString('base64')}`
  )
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  const body = new URLSearchParams(init.body as string)
  expect(body.get('grant_type')).toBe('account_credentials')
  expect(body.get('account_id')).toBe('AbCdEf123')
}

describe('mintZoomServiceAccountToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the minted token, granted scopes, and derived identity on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'zoom-access',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'meeting:read:meeting:admin user:read:user:admin',
        api_url: 'https://api.zoom.us',
      })
    )

    const result = await mintZoomServiceAccountToken(FIELDS)

    expect(result).toEqual({
      accessToken: 'zoom-access',
      expiresInSeconds: 3600,
      grantedScopes: ['meeting:read:meeting:admin', 'user:read:user:admin'],
      identity: {
        displayName: 'Zoom account AbCdEf123',
        auditMetadata: { zoomAccountId: 'AbCdEf123', zoomClientId: 'zoom-cid' },
        storedMetadata: {
          apiUrl: 'https://api.zoom.us',
          grantedScopes: 'meeting:read:meeting:admin user:read:user:admin',
        },
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expectMintCall()
  })

  it('omits the identity when skipIdentity is set', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'zoom-access',
        expires_in: 3600,
        scope: 'meeting:read:meeting:admin',
      })
    )

    const result = await mintZoomServiceAccountToken(FIELDS, { skipIdentity: true })

    expect(result).toEqual({
      accessToken: 'zoom-access',
      expiresInSeconds: 3600,
      grantedScopes: ['meeting:read:meeting:admin'],
    })
  })

  it('omits storedMetadata and scopes when the response lacks api_url and scope', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'zoom-access', expires_in: 1800 })
    )

    const result = await mintZoomServiceAccountToken(FIELDS)

    expect(result.accessToken).toBe('zoom-access')
    expect(result.expiresInSeconds).toBe(1800)
    expect(result.grantedScopes).toBeUndefined()
    expect(result.identity?.storedMetadata).toBeUndefined()
  })

  it('throws invalid_credentials on 400 invalid_client', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, { error: 'invalid_client', reason: 'Invalid client_id or client_secret' })
    )

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ hint: 'invalid client_id or client_secret' }),
    })
  })

  it('throws invalid_credentials with a misconfig hint on 400 unsupported grant type', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, { reason: 'unsupported grant type', error: 'invalid_request' })
    )

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({
        hint: 'app is not a Server-to-Server OAuth app',
      }),
    })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limit_exceeded' }))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
    })
  })

  it('throws provider_unavailable on 503', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(503, '<html>unavailable</html>'))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws provider_unavailable on a 200 with a non-JSON body', async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(200, '<html>proxy page</html>'))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable when the success body is missing access_token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { token_type: 'bearer' }))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('throws provider_unavailable on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })
  })
})
