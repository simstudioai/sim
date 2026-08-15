/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_DRAFT_TTL_MS } from '@/lib/credentials/draft-constants'
import { createShopifyOAuthState, parseShopifyOAuthState } from '@/lib/oauth/shopify-state'

const CLIENT_SECRET = 'shopify-client-secret'
const USER_ID = 'user-1'
const SHOP_DOMAIN = 'example.myshopify.com'

function parse(
  state: string,
  overrides: { userId?: string; shopDomain?: string; now?: Date } = {}
) {
  return parseShopifyOAuthState({
    state,
    userId: overrides.userId ?? USER_ID,
    shopDomain: overrides.shopDomain ?? SHOP_DOMAIN,
    clientSecret: CLIENT_SECRET,
    now: overrides.now,
  })
}

describe('Shopify OAuth state', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps overlapping connection drafts bound to their own state', () => {
    const first = createShopifyOAuthState({
      userId: USER_ID,
      shopDomain: SHOP_DOMAIN,
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=first',
      clientSecret: CLIENT_SECRET,
    })
    const second = createShopifyOAuthState({
      userId: USER_ID,
      shopDomain: SHOP_DOMAIN,
      draftId: 'draft-2',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=second',
      clientSecret: CLIENT_SECRET,
    })

    expect(parse(first)).toEqual({
      draftId: 'draft-1',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=first',
    })
    expect(parse(second)).toEqual({
      draftId: 'draft-2',
      returnUrl: 'https://sim.test/oauth/credential-connected?flow=second',
    })
  })

  it('rejects tampered, cross-user, and cross-shop state', () => {
    const state = createShopifyOAuthState({
      userId: USER_ID,
      shopDomain: SHOP_DOMAIN,
      draftId: 'draft-1',
      clientSecret: CLIENT_SECRET,
    })
    const [payload, signature] = state.split('.')

    expect(() => parse(`${payload}x.${signature}`)).toThrow(
      'Shopify OAuth state signature is invalid'
    )
    expect(() => parse(state, { userId: 'user-2' })).toThrow(
      'Shopify OAuth state belongs to a different user'
    )
    expect(() => parse(state, { shopDomain: 'other.myshopify.com' })).toThrow(
      'Shopify OAuth state belongs to a different shop'
    )
  })

  it('rejects expired state', () => {
    const issuedAt = new Date('2026-08-14T18:00:00.000Z')
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt.getTime())
    const state = createShopifyOAuthState({
      userId: USER_ID,
      shopDomain: SHOP_DOMAIN,
      clientSecret: CLIENT_SECRET,
    })

    expect(parse(state, { now: new Date(issuedAt.getTime() + CREDENTIAL_DRAFT_TTL_MS) })).toEqual(
      {}
    )
    expect(() =>
      parse(state, { now: new Date(issuedAt.getTime() + CREDENTIAL_DRAFT_TTL_MS + 1) })
    ).toThrow('Shopify OAuth state is expired')
  })
})
