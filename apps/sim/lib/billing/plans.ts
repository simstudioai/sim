import {
  getFreeTierLimit,
  getProTierLimit,
  getTeamTierLimitPerSeat,
} from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/env'

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
 * Get plan limits for a given plan name
 */
export function getPlanLimits(planName: string): number {
  const plan = getPlanByName(planName)
  return plan?.limits.cost ?? getFreeTierLimit()
}
