import type Stripe from 'stripe'
import { CREDIT_TIERS } from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import { isTeam } from '@/lib/billing/plan-helpers'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/core/config/env'

export interface BillingPlan {
  name: string
  priceId: string
  annualDiscountPriceId?: string
  limits: {
    cost: number
  }
}

/**
 * Build the billing plans for the Better Auth Stripe plugin.
 *
 * Plans:
 *   - free
 *   - pro_6000  (Pro, $25/mo)   + team_6000
 *   - pro_25000 (Max, $100/mo)  + team_25000
 *   - enterprise (dynamic pricing)
 *
 * Legacy subscriptions with plan='pro' or plan='team' are handled by
 * plan-helpers.ts which maps them to their original dollar amounts.
 */
export function getPlans(): BillingPlan[] {
  const plans: BillingPlan[] = [
    {
      name: 'free',
      priceId: env.STRIPE_FREE_PRICE_ID || '',
      limits: { cost: getFreeTierLimit() },
    },
  ]

  const proPriceMap: Record<number, { monthly: string; annual: string }> = {
    25: {
      monthly: env.STRIPE_PRICE_TIER_25_MO || '',
      annual: env.STRIPE_PRICE_TIER_25_YR || '',
    },
    100: {
      monthly: env.STRIPE_PRICE_TIER_100_MO || '',
      annual: env.STRIPE_PRICE_TIER_100_YR || '',
    },
  }

  const teamPriceMap: Record<number, { monthly: string; annual: string }> = {
    25: {
      monthly: env.STRIPE_PRICE_TEAM_25_MO || '',
      annual: env.STRIPE_PRICE_TEAM_25_YR || '',
    },
    100: {
      monthly: env.STRIPE_PRICE_TEAM_100_MO || '',
      annual: env.STRIPE_PRICE_TEAM_100_YR || '',
    },
  }

  for (const tier of CREDIT_TIERS) {
    const proPrices = proPriceMap[tier.dollars]
    const teamPrices = teamPriceMap[tier.dollars]

    const creditValueDollars = tier.credits / CREDIT_MULTIPLIER

    if (proPrices?.monthly) {
      plans.push({
        name: `pro_${tier.credits}`,
        priceId: proPrices.monthly,
        annualDiscountPriceId: proPrices.annual || undefined,
        limits: { cost: creditValueDollars },
      })
    }

    if (teamPrices?.monthly) {
      plans.push({
        name: `team_${tier.credits}`,
        priceId: teamPrices.monthly,
        annualDiscountPriceId: teamPrices.annual || undefined,
        limits: { cost: creditValueDollars },
      })
    }
  }

  plans.push({
    name: 'enterprise',
    priceId: 'price_dynamic',
    limits: { cost: 200 },
  })

  return plans
}

/**
 * Get a specific plan by name
 */
export function getPlanByName(planName: string): BillingPlan | undefined {
  return getPlans().find((plan) => plan.name === planName)
}

/**
 * Get a specific plan by Stripe price ID.
 * Matches against both monthly (`priceId`) and annual (`annualDiscountPriceId`) prices.
 */
export function getPlanByPriceId(priceId: string): BillingPlan | undefined {
  if (!priceId) return undefined
  return getPlans().find(
    (plan) => plan.priceId === priceId || plan.annualDiscountPriceId === priceId
  )
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
  isAnnual: boolean
}

/**
 * Resolve plan information from a Stripe subscription object.
 */
export function resolvePlanFromStripeSubscription(
  stripeSubscription: Stripe.Subscription
): StripePlanResolution {
  const priceId = stripeSubscription?.items?.data?.[0]?.price?.id
  const interval = stripeSubscription?.items?.data?.[0]?.price?.recurring?.interval
  const plan = priceId ? getPlanByPriceId(priceId) : undefined

  return {
    priceId,
    planFromStripe: plan?.name ?? null,
    isTeamPlan: plan ? isTeam(plan.name) : false,
    isAnnual: interval === 'year',
  }
}
