import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { coordinated } = vi.hoisted(() => ({ coordinated: vi.fn() }))

vi.mock('@/lib/credentials/coordinated-client-token', () => ({
  resolveCoordinatedClientToken: coordinated,
}))

import { mintAtlassianServiceAccountToken } from '@/lib/credentials/atlassian-client-credentials'

const mockFetch = vi.fn<typeof fetch>()

describe('Atlassian service-account OAuth 2.0 credentials', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    coordinated.mockReset()
    coordinated.mockImplementation(
      async (input: { exchange: () => Promise<{ accessToken: string; expiresAt: Date }> }) => {
        const exchanged = await input.exchange()
        return {
          accessToken: exchanged.accessToken,
          expiresInSeconds: Math.round((exchanged.expiresAt.getTime() - Date.now()) / 1000),
        }
      }
    )
  })

  it('exchanges the client credentials at the fixed Atlassian token endpoint', async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      expect(request.url).toBe('https://auth.atlassian.com/oauth/token')
      expect(request.method).toBe('POST')
      expect(request.redirect).toBe('error')
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect([...new URLSearchParams(await request.text())]).toEqual([
        ['grant_type', 'client_credentials'],
        ['client_id', 'atl-client'],
        ['client_secret', 'atl-secret'],
      ])
      return jsonResponse({ access_token: 'atl-token', expires_in: 3600, token_type: 'Bearer' })
    })

    const minted = await mintAtlassianServiceAccountToken('atl-client', 'atl-secret')

    expect(minted.accessToken).toBe('atl-token')
    expect(coordinated).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'atlassian', application: ['atl-client'] })
    )
  })

  it('never keeps a token longer than the documented 60 minutes', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: 'atl-token', expires_in: 86400 }))

    const minted = await mintAtlassianServiceAccountToken('atl-client', 'atl-secret')

    expect(minted.expiresInSeconds).toBeLessThanOrEqual(3600)
  })

  it('never sends a request without a client secret', async () => {
    await expect(mintAtlassianServiceAccountToken('atl-client', '')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(coordinated).not.toHaveBeenCalled()
  })
})
