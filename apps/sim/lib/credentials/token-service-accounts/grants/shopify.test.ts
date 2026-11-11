import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { coordinated } = vi.hoisted(() => ({ coordinated: vi.fn() }))

vi.mock('@/lib/credentials/coordinated-client-token', () => ({
  resolveCoordinatedClientToken: coordinated,
}))

import { mintShopifyClientCredentialsToken } from '@/lib/credentials/token-service-accounts/grants/shopify'

const FIELDS = {
  clientId: 'shopify-client',
  clientSecret: 'shopify-secret',
  domain: 'https://Acme-Store.myshopify.com/',
}

const mockFetch = vi.fn<typeof fetch>()

describe('Shopify client credentials grant', () => {
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

  it('exchanges the client credentials at the store token endpoint without a scope', async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      expect(request.url).toBe('https://acme-store.myshopify.com/admin/oauth/access_token')
      expect(request.method).toBe('POST')
      expect(request.redirect).toBe('error')
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect([...new URLSearchParams(await request.text())]).toEqual([
        ['grant_type', 'client_credentials'],
        ['client_id', 'shopify-client'],
        ['client_secret', 'shopify-secret'],
      ])
      return jsonResponse({ access_token: 'shop-token', scope: 'read_products', expires_in: 86399 })
    })

    const minted = await mintShopifyClientCredentialsToken(FIELDS)

    expect(minted.accessToken).toBe('shop-token')
    expect(minted.expiresInSeconds).toBeGreaterThan(86_000)
    expect(coordinated).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'shopify',
        application: ['acme-store.myshopify.com', 'shopify-client'],
      })
    )
  })

  it.each(['localhost', 'acme.myshopify.com.evil.example', '169.254.169.254', 'acme.example.com'])(
    'refuses %s before any request',
    async (domain) => {
      await expect(mintShopifyClientCredentialsToken({ ...FIELDS, domain })).rejects.toMatchObject({
        code: 'site_not_found',
        status: 400,
      })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(coordinated).not.toHaveBeenCalled()
    }
  )

  it('reports shop_not_permitted as a refused grant rather than a bad secret', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        {
          error: 'shop_not_permitted',
          error_description: 'Client credentials cannot be performed on this shop.',
        },
        { status: 400 }
      )
    )

    await expect(mintShopifyClientCredentialsToken(FIELDS)).rejects.toMatchObject({
      code: 'grant_not_permitted',
    })
  })

  it('reports a store Shopify cannot find as a wrong domain, not a bad secret', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'not_found' }, { status: 404 }))

    await expect(mintShopifyClientCredentialsToken(FIELDS)).rejects.toMatchObject({
      code: 'site_not_found',
    })
  })

  it('reports any other refusal by its status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'invalid_client' }, { status: 401 }))

    await expect(mintShopifyClientCredentialsToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('never keeps a token longer than the documented 24 hours', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ access_token: 'shop-token', expires_in: 9_999_999 }))

    const minted = await mintShopifyClientCredentialsToken(FIELDS)

    expect(minted.expiresInSeconds).toBeLessThanOrEqual(86_400)
  })

  it('never sends a request without a client secret', async () => {
    await expect(
      mintShopifyClientCredentialsToken({ ...FIELDS, clientSecret: '' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
