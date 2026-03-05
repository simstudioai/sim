import type Stripe from 'stripe'
import { CREDIT_TIERS } from '@/lib/billing/constants'
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
 * Map a dollar amount to the matching monthly Stripe price ID.
 * Falls back to the legacy `STRIPE_PRO_PRICE_ID` / `STRIPE_TEAM_PRICE_ID`
 * for the $20 and $40 tiers to preserve backward compat.
 */
function getMonthlyPriceId(dollars: number): string {
  const tierEnvMap: Record<number, string | undefined> = {
    20: env.STRIPE_PRICE_TIER_20_MO || env.STRIPE_PRO_PRICE_ID,
    40: env.STRIPE_PRICE_TIER_40_MO || env.STRIPE_TEAM_PRICE_ID,
    60: env.STRIPE_PRICE_TIER_60_MO,
    80: env.STRIPE_PRICE_TIER_80_MO,
    100: env.STRIPE_PRICE_TIER_100_MO,
    120: env.STRIPE_PRICE_TIER_120_MO,
    140: env.STRIPE_PRICE_TIER_140_MO,
    160: env.STRIPE_PRICE_TIER_160_MO,
    180: env.STRIPE_PRICE_TIER_180_MO,
    200: env.STRIPE_PRICE_TIER_200_MO,
  }
  return tierEnvMap[dollars] || ''
}

/**
 * Map a dollar amount to the matching annual Stripe price ID.
 */
function getAnnualPriceId(dollars: number): string {
  const tierEnvMap: Record<number, string | undefined> = {
    20: env.STRIPE_PRICE_TIER_20_YR,
    40: env.STRIPE_PRICE_TIER_40_YR,
    60: env.STRIPE_PRICE_TIER_60_YR,
    80: env.STRIPE_PRICE_TIER_80_YR,
    100: env.STRIPE_PRICE_TIER_100_YR,
    120: env.STRIPE_PRICE_TIER_120_YR,
    140: env.STRIPE_PRICE_TIER_140_YR,
    160: env.STRIPE_PRICE_TIER_160_YR,
    180: env.STRIPE_PRICE_TIER_180_YR,
    200: env.STRIPE_PRICE_TIER_200_YR,
  }
  return tierEnvMap[dollars] || ''
}

/**
 * Build the full set of billing plans for the Better Auth Stripe plugin.
 *
 * Structure:
 *   - 1 free plan
 *   - 10 pro tiers  (pro_2000 .. pro_20000), each with monthly + annual prices
 *   - 10 team tiers (team_2000 .. team_20000), sharing the same Stripe prices
 *   - 1 enterprise plan (dynamic pricing)
 *
 * Legacy `STRIPE_PRO_PRICE_ID` is reused as the $20/mo tier,
 * and `STRIPE_TEAM_PRICE_ID` as the $40/mo tier, so existing
 * subscriptions resolve correctly with zero migration.
 */
export function getPlans(): BillingPlan[] {
  const plans: BillingPlan[] = [
    {
      name: 'free',
      priceId: env.STRIPE_FREE_PRICE_ID || '',
      limits: { cost: getFreeTierLimit() },
    },
  ]

  for (const tier of CREDIT_TIERS) {
    const monthlyPriceId = getMonthlyPriceId(tier.dollars)
    const annualPriceId = getAnnualPriceId(tier.dollars)

    plans.push({
      name: `pro_${tier.credits}`,
      priceId: monthlyPriceId,
      annualDiscountPriceId: annualPriceId,
      limits: { cost: tier.dollars },
    })

    plans.push({
      name: `team_${tier.credits}`,
      priceId: monthlyPriceId,
      annualDiscountPriceId: annualPriceId,
      limits: { cost: tier.dollars },
    })
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
 * Used to get the authoritative plan from Stripe rather than relying on DB state.
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
