import {
  DEFAULT_ENTERPRISE_TIER_COST_LIMIT,
  DEFAULT_FREE_CREDITS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
} from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import {
  getPlanTierCredits,
  isEnterprise,
  isFree,
  isOrgPlan,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import { parseEnterpriseSubscriptionMetadata } from '@/lib/billing/types'
import { env } from '@/lib/core/config/env'

export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const

export const USABLE_SUBSCRIPTION_STATUSES = ['active'] as const

/**
 * Returns true when a subscription should still count as a paid plan entitlement.
 */
export function hasPaidSubscriptionStatus(status: string | null | undefined): boolean {
  return ENTITLED_SUBSCRIPTION_STATUSES.includes(
    status as (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number]
  )
}

/**
 * Returns true when a subscription status is usable for product access.
 */
export function hasUsableSubscriptionStatus(status: string | null | undefined): boolean {
  return USABLE_SUBSCRIPTION_STATUSES.includes(
    status as (typeof USABLE_SUBSCRIPTION_STATUSES)[number]
  )
}

/**
 * Returns true when a subscription is usable for product access.
 */
export function hasUsableSubscriptionAccess(
  status: string | null | undefined,
  billingBlocked: boolean | null | undefined
): boolean {
  return hasUsableSubscriptionStatus(status) && !billingBlocked
}

/**
 * Get the free tier limit from env or fallback to default
 */
export function getFreeTierLimit(): number {
  return env.FREE_TIER_COST_LIMIT || DEFAULT_FREE_CREDITS
}

/**
 * Get the pro tier limit from env or fallback to default
 */
export function getProTierLimit(): number {
  return env.PRO_TIER_COST_LIMIT || DEFAULT_PRO_TIER_COST_LIMIT
}

/**
 * Get the team tier limit per seat from env or fallback to default
 */
export function getTeamTierLimitPerSeat(): number {
  return env.TEAM_TIER_COST_LIMIT || DEFAULT_TEAM_TIER_COST_LIMIT
}

/**
 * Get the enterprise tier limit per seat from env or fallback to default
 */
export function getEnterpriseTierLimitPerSeat(): number {
  return env.ENTERPRISE_TIER_COST_LIMIT || DEFAULT_ENTERPRISE_TIER_COST_LIMIT
}

export function checkEnterprisePlan(subscription: any): boolean {
  return isEnterprise(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

export function getEffectiveSeats(subscription: any): number {
  if (!subscription) {
    return 0
  }

  if (isEnterprise(subscription.plan)) {
    const metadata = parseEnterpriseSubscriptionMetadata(subscription.metadata)
    if (metadata) {
      return metadata.seats
    }
    return 0
  }

  // Mirrors the Stripe subscription's `quantity`. For personal Pro this
  // is null in practice, so `?? 0` returns 0. For Team, fall back to 1
  // while the seat value has not yet been synced from Stripe so invite
  // and seat-validation flows don't transiently read as zero seats.
  if (isTeam(subscription.plan)) {
    return subscription.seats ?? (hasPaidSubscriptionStatus(subscription.status) ? 1 : 0)
  }

  if (isPro(subscription.plan)) {
    return subscription.seats ?? 0
  }

  return 0
}

export function checkProPlan(subscription: any): boolean {
  return isPro(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

export function checkTeamPlan(subscription: any): boolean {
  return isTeam(subscription?.plan) && hasPaidSubscriptionStatus(subscription?.status)
}

/**
 * True when the subscription's `referenceId` is an org (i.e. not the
 * caller's own `userId`). Prefer this over plan-name checks for scope
 * decisions — a `pro_*` sub attached to an org is org-scoped even though
 * `isTeam` / `isOrgPlan` return false.
 */
export function isOrgScopedSubscription(
  subscription: { referenceId?: string | null } | null | undefined,
  userId: string
): boolean {
  if (!subscription?.referenceId) return false
  return subscription.referenceId !== userId
}

/**
 * Get the minimum usage limit for an individual user (used for validation).
 *
 * Callers should only invoke this for **personally-scoped** subscriptions —
 * any org-scoped subscription (team, enterprise, or `pro_*` attached to an
 * organization) uses the organization-level limit instead. Callers are
 * responsible for gating with `isOrgScopedSubscription` before calling.
 *
 * @param subscription The subscription object
 * @returns The per-user minimum limit in dollars
 */
export function getPerUserMinimumLimit(subscription: any): number {
  if (!subscription || !hasPaidSubscriptionStatus(subscription.status)) {
    return getFreeTierLimit()
  }

  if (isPro(subscription.plan)) {
    const tierCredits = getPlanTierCredits(subscription.plan)
    if (tierCredits > 0) return tierCredits / CREDIT_MULTIPLIER
    return getProTierLimit()
  }

  if (isOrgPlan(subscription.plan)) {
    return 0
  }

  return getFreeTierLimit()
}

/**
 * Check if a user can edit their usage limits based on their subscription
 * Free and Enterprise plans cannot edit limits
 * Pro and Team plans can increase their limits
 * @param subscription The subscription object
 * @returns Whether the user can edit their usage limits
 */
export function canEditUsageLimit(subscription: any): boolean {
  if (!subscription || !hasUsableSubscriptionStatus(subscription.status)) {
    return false // Free plan users cannot edit limits
  }

  // Only Pro and Team plans can edit limits
  // Enterprise has fixed limits that match their monthly cost
  return isPro(subscription.plan) || isTeam(subscription.plan)
}

/**
 * Get pricing info for a plan. Supports both legacy names (`'pro'`, `'team'`)
 * and new credit-tier names (`'pro_4000'`, `'team_8000'`).
 */
export function getPlanPricing(plan: string): { basePrice: number } {
  if (isFree(plan)) return { basePrice: 0 }
  if (isEnterprise(plan)) return { basePrice: getEnterpriseTierLimitPerSeat() }

  if (isPro(plan) || isTeam(plan)) {
    const tierCredits = getPlanTierCredits(plan)
    if (tierCredits > 0) return { basePrice: tierCredits / CREDIT_MULTIPLIER }
    return { basePrice: isPro(plan) ? getProTierLimit() : getTeamTierLimitPerSeat() }
  }

  return { basePrice: 0 }
}
