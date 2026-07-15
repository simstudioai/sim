/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateShopifyServiceAccount } from '@/lib/credentials/token-service-accounts/validators/shopify'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateShopifyServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns shop metadata and the normalized domain on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          shop: {
            name: 'Acme Store',
            myshopifyDomain: 'acme-store.myshopify.com',
            email: 'ops@acme.com',
          },
        },
      })
    )

    const result = await validateShopifyServiceAccount({
      apiToken: 'shpat_abc',
      domain: 'https://Acme-Store.myshopify.com/',
    })

    expect(result).toEqual({
      displayName: 'Acme Store',
      auditMetadata: { shopifyShopDomain: 'acme-store.myshopify.com' },
      storedMetadata: { shopDomain: 'acme-store.myshopify.com', shopName: 'Acme Store' },
      normalizedDomain: 'acme-store.myshopify.com',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://acme-store.myshopify.com/admin/api/2024-10/graphql.json',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': 'shpat_abc',
        },
        body: JSON.stringify({ query: '{ shop { name myshopifyDomain email } }' }),
      }
    )
  })

  it.each(['evil.com', 'localhost', 'sub.myshopify.com.evil.com'])(
    'rejects non-Shopify host %s without fetching',
    async (domain) => {
      await expect(
        validateShopifyServiceAccount({ apiToken: 'shpat_abc', domain })
      ).rejects.toMatchObject({
        name: 'TokenServiceAccountValidationError',
        code: 'site_not_found',
        status: 400,
      })
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { errors: 'Invalid API key' }))

    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_bad', domain: 'acme.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws site_not_found on 404', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { errors: 'Not Found' }))

    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_abc', domain: 'no-shop.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'site_not_found',
      status: 404,
    })
  })

  it('throws provider_unavailable on 500', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { errors: 'Internal Server Error' }))

    const error = await validateShopifyServiceAccount({
      apiToken: 'shpat_abc',
      domain: 'acme.myshopify.com',
    }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })
})
