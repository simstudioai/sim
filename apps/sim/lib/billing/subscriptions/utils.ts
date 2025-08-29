import {
  DEFAULT_ENTERPRISE_TIER_COST_LIMIT,
  DEFAULT_FREE_CREDITS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
} from '@/lib/billing/constants'
import type { EnterpriseSubscriptionMetadata } from '@/lib/billing/types'
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
 * - Enterprise: Seats * per-seat price (pooled, with optional custom pricing in metadata)
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
    const metadata = subscription.metadata as EnterpriseSubscriptionMetadata | undefined

    // Enterprise uses per-seat pricing (pooled like Team)
    // Custom per-seat price can be set in metadata
    let perSeatPrice = getEnterpriseTierLimitPerSeat()
    if (metadata?.perSeatPrice) {
      const parsed = Number.parseFloat(String(metadata.perSeatPrice))
      if (parsed > 0 && !Number.isNaN(parsed)) {
        perSeatPrice = parsed
      }
    }

    return seats * perSeatPrice
  }

  return getFreeTierLimit()
}

/**
 * Get the minimum usage limit for an individual user (used for validation)
 * - Pro: User's plan minimum
 * - Team: 0 (pooled model, no individual minimums)
 * - Enterprise: 0 (pooled model, no individual minimums)
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
    // For enterprise plans, return the total pooled limit (seats * cost per seat)
    // This becomes the user's individual limit representing their share of the enterprise pool
    let perSeatPrice = getEnterpriseTierLimitPerSeat()
    if (subscription.metadata?.perSeatPrice) {
      const parsed = Number.parseFloat(String(subscription.metadata.perSeatPrice))
      if (parsed > 0 && !Number.isNaN(parsed)) {
        perSeatPrice = parsed
      }
    }
    return seats * perSeatPrice
  }

  return getFreeTierLimit()
}

/**
 * Check if a user can edit their usage limits based on their subscription
 * Free plan users cannot edit limits, paid plan users can
 * @param subscription The subscription object
 * @returns Whether the user can edit their usage limits
 */
export function canEditUsageLimit(subscription: any): boolean {
  if (!subscription || subscription.status !== 'active') {
    return false // Free plan users cannot edit limits
  }

  return (
    subscription.plan === 'pro' ||
    subscription.plan === 'team' ||
    subscription.plan === 'enterprise'
  )
}

/**
 * Get the minimum allowed usage limit for a subscription
 * This prevents users from setting limits below their plan's base amount
 * @param subscription The subscription object
 * @returns The minimum allowed usage limit in dollars
 */
export function getMinimumUsageLimit(subscription: any): number {
  return getPerUserMinimumLimit(subscription)
}
