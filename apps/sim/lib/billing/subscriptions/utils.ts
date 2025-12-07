import {
  DEFAULT_ENTERPRISE_TIER_COST_LIMIT,
  DEFAULT_FREE_CREDITS,
  DEFAULT_PRO_TIER_COST_LIMIT,
  DEFAULT_TEAM_TIER_COST_LIMIT,
} from '@/lib/billing/constants'
import type { EnterpriseSubscriptionMetadata } from '@/lib/billing/types'
import { env } from '@/lib/core/config/env'

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

/**
 * Type guard to check if metadata is valid EnterpriseSubscriptionMetadata
 */
function isEnterpriseMetadata(metadata: unknown): metadata is EnterpriseSubscriptionMetadata {
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    'seats' in metadata &&
    typeof (metadata as EnterpriseSubscriptionMetadata).seats === 'string'
  )
}

export function getEffectiveSeats(subscription: any): number {
  if (!subscription) {
    return 0
  }

  if (subscription.plan === 'enterprise') {
    const metadata = subscription.metadata as EnterpriseSubscriptionMetadata | null
    if (isEnterpriseMetadata(metadata)) {
      return Number.parseInt(metadata.seats, 10)
    }
    return 0
  }

  if (subscription.plan === 'team') {
    return subscription.seats ?? 0
  }

  return 0
}

export function checkProPlan(subscription: any): boolean {
  return subscription?.plan === 'pro' && subscription?.status === 'active'
}

export function checkTeamPlan(subscription: any): boolean {
  return subscription?.plan === 'team' && subscription?.status === 'active'
}

/**
 * Get the minimum usage limit for an individual user (used for validation)
 * Only applicable for plans with individual limits (Free/Pro)
 * Team and Enterprise plans use organization-level limits instead
 * @param subscription The subscription object
 * @returns The per-user minimum limit in dollars
 */
export function getPerUserMinimumLimit(subscription: any): number {
  if (!subscription || subscription.status !== 'active') {
    return getFreeTierLimit()
  }

  if (subscription.plan === 'pro') {
    return getProTierLimit()
  }

  if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
    // Team and Enterprise don't have individual limits - they use organization limits
    // This function should not be called for these plans
    // Returning 0 to indicate no individual minimum
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

/**
 * Get pricing info for a plan
 */
export function getPlanPricing(plan: string): { basePrice: number } {
  switch (plan) {
    case 'free':
      return { basePrice: 0 }
    case 'pro':
      return { basePrice: getProTierLimit() }
    case 'team':
      return { basePrice: getTeamTierLimitPerSeat() }
    case 'enterprise':
      return { basePrice: getEnterpriseTierLimitPerSeat() }
    default:
      return { basePrice: 0 }
  }
}
