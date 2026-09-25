import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintZoomServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/zoom'

const TOKEN_URL = 'https://zoom.us/oauth/token'

const FIELDS = { clientId: 'zoom-cid', clientSecret: 'zoom-secret', orgId: 'AbCdEf123' }

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
    vi.stubGlobal('fetch', mockFetch)
  })

  it('returns the minted token, granted scopes, and derived identity on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
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
        principal: { kind: 'tenant', id: 'AbCdEf123' },
        auditMetadata: { zoomClientId: 'zoom-cid' },
        storedMetadata: {
          apiUrl: 'https://api.zoom.us',
          grantedScopes: 'meeting:read:meeting:admin user:read:user:admin',
        },
      },
    })
    expectMintCall()
  })

  it('throws invalid_credentials on 400 invalid_client', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_client', reason: 'Invalid client_id or client_secret' }, 400)
    )

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
      logDetail: expect.objectContaining({ hint: 'invalid client_id or client_secret' }),
    })
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'rate_limit_exceeded' }, 429))

    await expect(mintZoomServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
    })
  })
})
