import {
  DEFAULT_ENTERPRISE_TIER_COST_LIMIT,
  DEFAULT_FREE_CREDITS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
} from '@/lib/billing/constants'
import { env } from '@/lib/env'

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
  return subscription?.plan === 'enterprise' && subscription?.status === 'active'
}

export function checkProPlan(subscription: any): boolean {
  return subscription?.plan === 'pro' && subscription?.status === 'active'
}

export function checkTeamPlan(subscription: any): boolean {
  return subscription?.plan === 'team' && subscription?.status === 'active'
}

/**
 * Calculate the total subscription-level allowance (what the org/user gets for their base payment)
 * - Pro: Fixed amount per user
 * - Team: Seats * base price (pooled for the org)
 * - Enterprise: Unlimited usage (no overages)
 * @param subscription The subscription object
 * @returns The total subscription allowance in dollars
 */
export function getSubscriptionAllowance(subscription: any): number {
  if (!subscription || subscription.status !== 'active') {
    return getFreeTierLimit()
  }

  const seats = subscription.seats || 1

  if (subscription.plan === 'pro') {
    return getProTierLimit()
  }
  if (subscription.plan === 'team') {
    return seats * getTeamTierLimitPerSeat()
  }
  if (subscription.plan === 'enterprise') {
    // Enterprise has fixed pricing - allowance equals their monthly cost
    // This is configured per organization, not calculated from seats
    return 0
  }

  return getFreeTierLimit()
}

/**
 * Get the minimum usage limit for an individual user (used for validation)
 * - Pro: User's plan minimum
 * - Team: Pooled limit shared across team
 * - Enterprise: Unlimited (no limit)
 * @param subscription The subscription object
 * @returns The per-user minimum limit in dollars
 */
export function getPerUserMinimumLimit(subscription: any): number {
  if (!subscription || subscription.status !== 'active') {
    return getFreeTierLimit()
  }

  const seats = subscription.seats || 1

  if (subscription.plan === 'pro') {
    return getProTierLimit()
  }
  if (subscription.plan === 'team') {
    // For team plans, return the total pooled limit (seats * cost per seat)
    // This becomes the user's individual limit representing their share of the team pool
    return seats * getTeamTierLimitPerSeat()
  }
  if (subscription.plan === 'enterprise') {
    // Enterprise has fixed pricing - limit is managed at organization level
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
  if (!subscription || subscription.status !== 'active') {
    return false // Free plan users cannot edit limits
  }

  // Only Pro and Team plans can edit limits
  // Enterprise has fixed limits that match their monthly cost
  return subscription.plan === 'pro' || subscription.plan === 'team'
}
