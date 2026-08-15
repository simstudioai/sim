/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@sim/security/hmac'
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCompleteShopifyOAuthConnection, mockGetSession, mockRequireConfiguredOAuthClient } =
  vi.hoisted(() => ({
    mockCompleteShopifyOAuthConnection: vi.fn(),
    mockGetSession: vi.fn(),
    mockRequireConfiguredOAuthClient: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  requireConfiguredOAuthClient: mockRequireConfiguredOAuthClient,
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))
vi.mock('@/lib/oauth/shopify', () => ({
  completeShopifyOAuthConnection: mockCompleteShopifyOAuthConnection,
}))

import { createShopifyOAuthState } from '@/lib/oauth/shopify-state'
import { GET } from '@/app/api/auth/oauth2/callback/shopify/route'

const CLIENT_SECRET = 'shopify-client-secret'
const SHOP_DOMAIN = 'example.myshopify.com'

function callbackRequest(state: string) {
  const searchParams = new URLSearchParams({
    code: 'authorization-code',
    shop: SHOP_DOMAIN,
    state,
  })
  const message = [...searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  searchParams.set('hmac', hmacSha256Hex(message, CLIENT_SECRET))

  return createMockRequest(
    'GET',
    undefined,
    {
      cookie:
        'shopify_credential_draft_id=draft-from-shared-cookie; shopify_return_url=https%3A%2F%2Fsim.test%2Foauth%2Fcredential-connected%3Fresult%3Dconnected',
    },
    `https://sim.test/api/auth/oauth2/callback/shopify?${searchParams.toString()}`
  )
}

describe('Shopify OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockRequireConfiguredOAuthClient.mockReturnValue({
      values: {
        SHOPIFY_CLIENT_ID: 'shopify-client-id',
        SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
      },
    })
    mockCompleteShopifyOAuthConnection.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ access_token: 'shopify-token', scope: 'read_products' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    )
  })

  it('completes the credential draft carried by signed state instead of a shared cookie', async () => {
    const state = createShopifyOAuthState({
      userId: 'user-1',
      shopDomain: SHOP_DOMAIN,
      draftId: 'draft-from-state',
      returnUrl: 'https://sim.test/oauth/credential-connected?result=connected',
      clientSecret: CLIENT_SECRET,
    })

    const response = await GET(callbackRequest(state))

    expect(mockCompleteShopifyOAuthConnection).toHaveBeenCalledWith({
      accessToken: 'shopify-token',
      shopDomain: SHOP_DOMAIN,
      scope: 'read_products',
      userId: 'user-1',
      draftId: 'draft-from-state',
      signal: expect.any(AbortSignal),
    })
    expect(response.headers.get('location')).toBe(
      'https://sim.test/oauth/credential-connected?result=connected&shopify_connected=true'
    )
  })

  it('keeps overlapping flows bound to their own return destinations', async () => {
    const firstState = createShopifyOAuthState({
      userId: 'user-1',
      shopDomain: SHOP_DOMAIN,
      draftId: 'draft-first',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=first',
      clientSecret: CLIENT_SECRET,
    })
    const secondState = createShopifyOAuthState({
      userId: 'user-1',
      shopDomain: SHOP_DOMAIN,
      draftId: 'draft-second',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=second',
      clientSecret: CLIENT_SECRET,
    })

    const firstResponse = await GET(callbackRequest(firstState))
    const secondResponse = await GET(callbackRequest(secondState))

    expect(firstResponse.headers.get('location')).toBe(
      'https://sim.test/oauth/credential-connected?flow=first&shopify_connected=true'
    )
    expect(secondResponse.headers.get('location')).toBe(
      'https://sim.test/oauth/credential-connected?flow=second&shopify_connected=true'
    )
    expect(mockCompleteShopifyOAuthConnection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ draftId: 'draft-first' })
    )
    expect(mockCompleteShopifyOAuthConnection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ draftId: 'draft-second' })
    )
  })
})
