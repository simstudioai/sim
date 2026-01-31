import type Stripe from 'stripe'
import {
  getFreeTierLimit,
  getProTierLimit,
  getTeamTierLimitPerSeat,
} from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/core/config/env'

export interface BillingPlan {
  name: string
  priceId: string
  limits: {
    cost: number
  }
}

/**
 * Get the billing plans configuration for Better Auth Stripe plugin
 */
export function getPlans(): BillingPlan[] {
  return [
    {
      name: 'free',
      priceId: env.STRIPE_FREE_PRICE_ID || '',
      limits: {
        cost: getFreeTierLimit(),
      },
    },
    {
      name: 'pro',
      priceId: env.STRIPE_PRO_PRICE_ID || '',
      limits: {
        cost: getProTierLimit(),
      },
    },
    {
      name: 'team',
      priceId: env.STRIPE_TEAM_PRICE_ID || '',
      limits: {
        cost: getTeamTierLimitPerSeat(),
      },
    },
    {
      name: 'enterprise',
      priceId: 'price_dynamic',
      limits: {
        cost: getTeamTierLimitPerSeat(),
      },
    },
  ]
}

/**
 * Get a specific plan by name
 */
export function getPlanByName(planName: string): BillingPlan | undefined {
  return getPlans().find((plan) => plan.name === planName)
}

/**
 * Get a specific plan by Stripe price ID
 */
export function getPlanByPriceId(priceId: string): BillingPlan | undefined {
  return getPlans().find((plan) => plan.priceId === priceId)
}

/**
 * Get plan limits for a given plan name
 */
export function getPlanLimits(planName: string): number {
  const plan = getPlanByName(planName)
  return plan?.limits.cost ?? getFreeTierLimit()
}

export interface StripePlanResolution {
  priceId: string | undefined
  planFromStripe: string | null
  isTeamPlan: boolean
}

/**
 * Resolve plan information from a Stripe subscription object.
 * Used to get the authoritative plan from Stripe rather than relying on DB state.
 */
export function resolvePlanFromStripeSubscription(
  stripeSubscription: Stripe.Subscription
): StripePlanResolution {
  const priceId = stripeSubscription?.items?.data?.[0]?.price?.id
  const plan = priceId ? getPlanByPriceId(priceId) : undefined

  return {
    priceId,
    planFromStripe: plan?.name ?? null,
    isTeamPlan: plan?.name === 'team',
  }
}
