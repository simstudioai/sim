/** @vitest-environment node */
import { stripe } from '@better-auth/stripe'
import { createMockStripeEvent, dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSyncSubscriptionUsageLimits } = vi.hoisted(() => ({
  mockSyncSubscriptionUsageLimits: vi.fn(),
}))

vi.mock('@/lib/billing/organization', () => ({
  syncSubscriptionUsageLimits: mockSyncSubscriptionUsageLimits,
}))

import { handleSubscriptionUsageUpdate } from '@/lib/billing/webhooks/subscription-usage'

const persistedSubscription = {
  id: 'subscription-1',
  referenceId: 'org-1',
  plan: 'team',
  status: 'active',
  seats: 2,
}

const updateEvent = () =>
  createMockStripeEvent('customer.subscription.updated', {
    id: 'sub_stripe',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: {},
    items: {
      data: [
        {
          id: 'si_1',
          quantity: 2,
          current_period_start: 1788220800,
          current_period_end: 1790812800,
          price: { id: 'price_team', recurring: { interval: 'month' } },
        },
      ],
    },
  })

describe('handleSubscriptionUsageUpdate', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockSyncSubscriptionUsageLimits.mockReset().mockResolvedValue(undefined)
    dbChainMockFns.limit.mockResolvedValue([persistedSubscription])
  })

  afterEach(resetDbChainMock)

  it('uses the persisted payer reference after subscription callbacks have rehomed it', async () => {
    await handleSubscriptionUsageUpdate(updateEvent())

    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'eq',
      left: schemaMock.subscription.stripeSubscriptionId,
      right: 'sub_stripe',
    })
    expect(mockSyncSubscriptionUsageLimits).toHaveBeenCalledExactlyOnceWith(persistedSubscription)
  })

  it('ignores other event types', async () => {
    await handleSubscriptionUsageUpdate(createMockStripeEvent('customer.subscription.created', {}))

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it('ignores subscriptions that are not tracked locally', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await handleSubscriptionUsageUpdate(updateEvent())

    expect(mockSyncSubscriptionUsageLimits).not.toHaveBeenCalled()
  })

  it.each(['lookup', 'reconciliation'])(
    'returns a failed webhook response on %s failure and reconciles on redelivery',
    async (failure) => {
      const onSubscriptionUpdate = vi.fn()
      const stripeClient = new Stripe('sk_test_placeholder')
      const webhookSecret = 'whsec_subscription_usage_test'
      const provider = betterAuth({
        baseURL: 'https://sim.test',
        secret: 'isolated-stripe-webhook-test-secret-123456789',
        database: memoryAdapter({
          user: [],
          session: [],
          account: [],
          verification: [],
          subscription: [
            {
              ...persistedSubscription,
              stripeCustomerId: 'cus_1',
              stripeSubscriptionId: 'sub_stripe',
            },
          ],
        }),
        logger: { disabled: true },
        plugins: [
          stripe({
            stripeClient,
            stripeWebhookSecret: webhookSecret,
            subscription: {
              enabled: true,
              plans: [{ name: 'team', priceId: 'price_team' }],
              onSubscriptionUpdate,
            },
            onEvent: handleSubscriptionUsageUpdate,
          }),
        ],
      })
      const payload = JSON.stringify(updateEvent())
      const signature = stripeClient.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
      })
      const deliver = () =>
        provider.handler(
          new Request('https://sim.test/api/auth/stripe/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
            body: payload,
          })
        )

      if (failure === 'lookup') {
        dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))
      } else {
        mockSyncSubscriptionUsageLimits.mockRejectedValueOnce(new Error('database unavailable'))
      }

      const failed = await deliver()
      expect(failed.ok).toBe(false)
      expect(await failed.json()).toMatchObject({ code: 'STRIPE_WEBHOOK_ERROR' })
      expect(onSubscriptionUpdate).toHaveBeenCalledOnce()

      const retried = await deliver()
      expect(retried.status).toBe(200)
      expect(await retried.json()).toEqual({ success: true })
      expect(onSubscriptionUpdate).toHaveBeenCalledTimes(2)
      expect(mockSyncSubscriptionUsageLimits).toHaveBeenLastCalledWith(persistedSubscription)
    }
  )
})
