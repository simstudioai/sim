/**
 * @vitest-environment node
 */
import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { didSubscriptionPriceChange } from '@/lib/billing/plans'

function subscriptionOn(priceId: string): Stripe.Subscription {
  // double-cast-allowed: only the item price ids are read
  return { items: { data: [{ price: { id: priceId } }] } } as unknown as Stripe.Subscription
}

function previousItemsOn(priceId: string, quantity: number) {
  return { items: { data: [{ price: { id: priceId }, quantity }] } }
}

describe('didSubscriptionPriceChange', () => {
  it('does not treat a seat-only update as a price change', () => {
    expect(
      didSubscriptionPriceChange(subscriptionOn('price_legacy'), previousItemsOn('price_legacy', 3))
    ).toBe(false)
  })

  it('detects a swap to a different price', () => {
    expect(
      didSubscriptionPriceChange(subscriptionOn('price_new'), previousItemsOn('price_legacy', 1))
    ).toBe(true)
  })

  it('does not treat an update without item changes as a price change', () => {
    expect(didSubscriptionPriceChange(subscriptionOn('price_legacy'), { status: 'active' })).toBe(
      false
    )
    expect(didSubscriptionPriceChange(subscriptionOn('price_legacy'), undefined)).toBe(false)
  })
})
