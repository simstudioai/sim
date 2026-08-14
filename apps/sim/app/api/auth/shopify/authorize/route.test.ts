/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireConfiguredOAuthClient: vi.fn(),
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
  createShopifyOAuthState: () => 'signed-state',
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
  })

  it('keeps the post-connect return URL for the full credential draft lifetime', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'https://sim.test/api/auth/shopify/authorize?shop=test-store.myshopify.com&returnUrl=https%3A%2F%2Fsim.test%2Foauth%2Fcredential-connected&draftId=draft-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('set-cookie')).toContain('shopify_return_url=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=900')
  })
})
