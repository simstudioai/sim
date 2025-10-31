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
 * Get the billing plans configuration for Better Auth Loops plugin
 * priceId is used as paymentLinkId for Loops (primary)
 * Falls back to Stripe for backward compatibility if Loops is not configured
 */
export function getPlans(): BillingPlan[] {
  return [
    {
      name: 'free',
      priceId: env.LOOPS_FREE_PAYMENT_LINK_ID || env.STRIPE_FREE_PRICE_ID || '',
      limits: {
        cost: getFreeTierLimit(),
      },
    },
    {
      name: 'pro',
      priceId: env.LOOPS_PRO_PAYMENT_LINK_ID || env.STRIPE_PRO_PRICE_ID || '',
      limits: {
        cost: getProTierLimit(),
      },
    },
    {
      name: 'team',
      priceId: env.LOOPS_TEAM_PAYMENT_LINK_ID || env.STRIPE_TEAM_PRICE_ID || '',
      limits: {
        cost: getTeamTierLimitPerSeat(),
      },
    },
    {
      name: 'enterprise',
      priceId: env.LOOPS_ENTERPRISE_PAYMENT_LINK_ID || env.STRIPE_ENTERPRISE_PRICE_ID || 'price_dynamic',
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
