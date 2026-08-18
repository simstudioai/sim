/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireConfiguredOAuthClient: vi.fn(),
  createShopifyOAuthState: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  requireConfiguredOAuthClient: mocks.requireConfiguredOAuthClient,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.test',
}))

vi.mock('@/lib/oauth/shopify-state', () => ({
  createShopifyOAuthState: mocks.createShopifyOAuthState,
}))

vi.mock('@/lib/oauth/utils', () => ({
  getScopesForService: () => ['read_products'],
}))

import { GET } from '@/app/api/auth/shopify/authorize/route'

describe('Shopify authorize route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.requireConfiguredOAuthClient.mockReturnValue({
      values: {
        SHOPIFY_CLIENT_ID: 'shopify-client',
        SHOPIFY_CLIENT_SECRET: 'shopify-secret',
      },
    })
    mocks.createShopifyOAuthState.mockReturnValue('signed-state')
  })

  it('binds the post-connect return URL to the signed flow state', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'https://sim.test/api/auth/shopify/authorize?shop=test-store.myshopify.com&returnUrl=https%3A%2F%2Fsim.test%2Foauth%2Fcredential-connected&draftId=draft-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(mocks.createShopifyOAuthState).toHaveBeenCalledWith({
      userId: 'user-1',
      shopDomain: 'test-store.myshopify.com',
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected',
      clientSecret: 'shopify-secret',
    })
    expect(response.headers.get('set-cookie')).toContain('shopify_return_url=;')
  })

  it('escapes a user-controlled draft id before embedding it in inline script', async () => {
    const url = new URL('https://sim.test/api/auth/shopify/authorize')
    url.searchParams.set('draftId', '</script><script>document.title=location.origin</script>')

    const response = await GET(createMockRequest('GET', undefined, {}, url.toString()))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(html).toContain('\\u003c/script>\\u003cscript>document.title=location.origin')
  })
})
