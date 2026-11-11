import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintLinearClientCredentialsToken } from '@/lib/credentials/token-service-accounts/grants/linear'

const FIELDS = { clientId: 'linear-client', clientSecret: 'linear-secret' }
const mockFetch = vi.fn<typeof fetch>()

describe('Linear client credentials grant', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('requests an app token with the one fixed scope set every credential shares', async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      expect(request.url).toBe('https://api.linear.app/oauth/token')
      expect(request.method).toBe('POST')
      expect(request.redirect).toBe('error')
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect([...new URLSearchParams(await request.text())]).toEqual([
        ['grant_type', 'client_credentials'],
        ['client_id', 'linear-client'],
        ['client_secret', 'linear-secret'],
        ['scope', 'read,write'],
      ])
      return jsonResponse({
        access_token: 'lin_oauth_1',
        token_type: 'Bearer',
        expires_in: 2_591_999,
        scope: ['read', 'write'],
      })
    })

    const minted = await mintLinearClientCredentialsToken(FIELDS)

    expect(minted.accessToken).toBe('lin_oauth_1')
  })

  it('reuses a 30-day token for at most an hour so an early revocation heals', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ access_token: 'lin_oauth_1', expires_in: 2_591_999 })
    )

    const minted = await mintLinearClientCredentialsToken(FIELDS)

    expect(minted.expiresInSeconds).toBe(3600)
  })

  it.each([
    [400, 'invalid_credentials'],
    [401, 'invalid_credentials'],
    [429, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('maps an HTTP %i token response to %s', async (status, code) => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        { error: 'unsupported_grant_type', error_description: 'Client does not support it' },
        { status }
      )
    )

    await expect(mintLinearClientCredentialsToken(FIELDS)).rejects.toMatchObject({ code })
  })

  it.each([
    ['no access token', { expires_in: 3600 }],
    ['no lifetime', { access_token: 'lin_oauth_1' }],
  ])('refuses a token response with %s', async (_label, body) => {
    mockFetch.mockResolvedValue(jsonResponse(body))

    await expect(mintLinearClientCredentialsToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('never sends a request without a client secret', async () => {
    await expect(
      mintLinearClientCredentialsToken({ ...FIELDS, clientSecret: '' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
