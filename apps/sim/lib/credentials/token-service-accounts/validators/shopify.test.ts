import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateShopifyServiceAccount } from '@/lib/credentials/token-service-accounts/validators/shopify'
import { SHOPIFY_API_VERSION } from '@/tools/shopify/constants'

const mockFetch = vi.fn()

describe('validateShopifyServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('queries the normalized store host on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          shop: {
            name: 'Acme Store',
            myshopifyDomain: 'acme-store.myshopify.com',
          },
        },
      })
    )

    const result = await validateShopifyServiceAccount({
      apiToken: 'shpat_abc',
      domain: 'https://Acme-Store.myshopify.com/',
    })

    expect(result.normalizedDomain).toBe('acme-store.myshopify.com')
    expect(mockFetch).toHaveBeenCalledWith(
      `https://acme-store.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': 'shpat_abc',
        },
        body: JSON.stringify({ query: '{ shop { name myshopifyDomain } }' }),
        signal: expect.any(AbortSignal),
      }
    )
  })

  it.each(['localhost', 'sub.myshopify.com.evil.com'])(
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

  it('throws site_not_found on 404', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ errors: 'Not Found' }, 404))

    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_abc', domain: 'no-shop.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'site_not_found',
      status: 404,
    })
  })

  /**
   * The store domain is caller-supplied, so a host that does not resolve is
   * wrong input rather than a Shopify outage — and `provider_unavailable`
   * would answer `503 + Retry-After` for a domain that can never work.
   */
  it('throws site_not_found when the store host does not resolve', async () => {
    const dnsError = new TypeError('fetch failed')
    ;(dnsError as { cause?: unknown }).cause = { code: 'ENOTFOUND' }
    mockFetch.mockRejectedValueOnce(dnsError)

    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_abc', domain: 'nope.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'site_not_found',
      status: 400,
    })
  })

  it('throws provider_unavailable when a 200 body carries GraphQL errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Internal error' }] }))

    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_abc', domain: 'acme.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
      status: 502,
    })
  })

  it('maps an auth-shaped GraphQL error in a 200 response to invalid_credentials', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        errors: [
          { message: 'Invalid API key or access token (unrecognized login or wrong password)' },
        ],
      })
    )
    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_bad', domain: 'my-store.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('does not blame the credential when an auth-shaped error accompanies a populated shop', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: { shop: { name: 'My Store', myshopifyDomain: 'my-store.myshopify.com' } },
        errors: [
          { message: 'Access denied for email field', extensions: { code: 'ACCESS_DENIED' } },
        ],
      })
    )
    /**
     * A per-field scope denial is not evidence the token is invalid. Reporting
     * it as `invalid_credentials` would tell an admin to replace a working
     * credential; only a response with no `shop` at all indicts the token.
     */
    await expect(
      validateShopifyServiceAccount({ apiToken: 'shpat_good', domain: 'my-store.myshopify.com' })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'provider_unavailable',
    })
  })
})
