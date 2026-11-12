import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { coordinated } = vi.hoisted(() => ({ coordinated: vi.fn() }))

vi.mock('@/lib/credentials/coordinated-client-token', () => ({
  resolveCoordinatedClientToken: coordinated,
}))

import { mintLinearClientCredentialsToken } from '@/lib/credentials/token-service-accounts/grants/linear'

const FIELDS = { clientId: 'linear-client', clientSecret: 'linear-secret' }
const mockFetch = vi.fn<typeof fetch>()

describe('Linear client credentials grant', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    coordinated.mockReset()
    coordinated.mockImplementation(
      async (input: { exchange: () => Promise<{ accessToken: string; expiresAt: Date }> }) => {
        const exchanged = await input.exchange()
        return {
          accessToken: exchanged.accessToken,
          expiresInSeconds: Math.floor((exchanged.expiresAt.getTime() - Date.now()) / 1000),
        }
      }
    )
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

  it('shares one token per app across credentials and replaces it daily', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ access_token: 'lin_oauth_1', expires_in: 2_591_999 })
    )

    const minted = await mintLinearClientCredentialsToken({
      ...FIELDS,
      clientId: ' linear-client ',
    })

    expect(minted.expiresInSeconds).toBeGreaterThan(86_000)
    expect(minted.expiresInSeconds).toBeLessThanOrEqual(86_400)
    expect(coordinated).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'linear',
        application: ['linear-client'],
        clientSecret: 'linear-secret',
      })
    )
  })

  it('never sends a request without a client secret', async () => {
    await expect(
      mintLinearClientCredentialsToken({ ...FIELDS, clientSecret: '' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
