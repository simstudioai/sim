/**
 * Helper functions for subscription-related computations
 * These are pure functions that compute values from subscription data
 */

import { DEFAULT_FREE_CREDITS } from '@/lib/billing/constants'
import { USAGE_PILL_COLORS } from './consts'
import type { BillingStatus, SubscriptionData, UsageData } from './types'

const defaultUsage: UsageData = {
  current: 0,
  limit: DEFAULT_FREE_CREDITS,
  percentUsed: 0,
  isWarning: false,
  isExceeded: false,
  billingPeriodStart: null,
  billingPeriodEnd: null,
  lastPeriodCost: 0,
}

/**
 * Get subscription status flags from subscription data
 */
export function getSubscriptionStatus(subscriptionData: SubscriptionData | null | undefined) {
  return {
    isPaid: subscriptionData?.isPaid ?? false,
    isPro: subscriptionData?.isPro ?? false,
    isTeam: subscriptionData?.isTeam ?? false,
    isEnterprise: subscriptionData?.isEnterprise ?? false,
    isFree: !(subscriptionData?.isPaid ?? false),
    plan: subscriptionData?.plan ?? 'free',
    status: subscriptionData?.status ?? null,
    seats: subscriptionData?.seats ?? null,
    metadata: subscriptionData?.metadata ?? null,
  }
}

/**
 * Get usage data from subscription data
 * Validates and sanitizes all numeric values to prevent crashes from malformed data
 */
export function getUsage(subscriptionData: SubscriptionData | null | undefined): UsageData {
  const usage = subscriptionData?.usage

  if (!usage) {
    return defaultUsage
  }

  return {
    current:
      typeof usage.current === 'number' && Number.isFinite(usage.current) ? usage.current : 0,
    limit:
      typeof usage.limit === 'number' && Number.isFinite(usage.limit)
        ? usage.limit
        : DEFAULT_FREE_CREDITS,
    percentUsed:
      typeof usage.percentUsed === 'number' && Number.isFinite(usage.percentUsed)
        ? usage.percentUsed
        : 0,
    isWarning: Boolean(usage.isWarning),
    isExceeded: Boolean(usage.isExceeded),
    billingPeriodStart: usage.billingPeriodStart ?? null,
    billingPeriodEnd: usage.billingPeriodEnd ?? null,
    lastPeriodCost:
      typeof usage.lastPeriodCost === 'number' && Number.isFinite(usage.lastPeriodCost)
        ? usage.lastPeriodCost
        : 0,
  }
}

/**
 * Get billing status based on usage and blocked state
 */
export function getBillingStatus(
  subscriptionData: SubscriptionData | null | undefined
): BillingStatus {
  const usage = getUsage(subscriptionData)
  const blocked = subscriptionData?.billingBlocked
  if (blocked) return 'blocked'
  if (usage.isExceeded) return 'exceeded'
  if (usage.isWarning) return 'warning'
  return 'ok'
}

/**
 * Get remaining budget
 */
export function getRemainingBudget(subscriptionData: SubscriptionData | null | undefined): number {
  const usage = getUsage(subscriptionData)
  return Math.max(0, usage.limit - usage.current)
}

/**
 * Get days remaining in billing period
 */
export function getDaysRemainingInPeriod(
  subscriptionData: SubscriptionData | null | undefined
): number | null {
  const usage = getUsage(subscriptionData)
  if (!usage.billingPeriodEnd) return null

  const now = new Date()
  const endDate = usage.billingPeriodEnd
  const diffTime = endDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return Math.max(0, diffDays)
}

/**
 * Check if subscription is at least Pro tier
 */
export function isAtLeastPro(subscriptionData: SubscriptionData | null | undefined): boolean {
  const status = getSubscriptionStatus(subscriptionData)
  return status.isPro || status.isTeam || status.isEnterprise
}

/**
 * Check if subscription is at least Team tier
 */
export function isAtLeastTeam(subscriptionData: SubscriptionData | null | undefined): boolean {
  const status = getSubscriptionStatus(subscriptionData)
  return status.isTeam || status.isEnterprise
}

export function canUpgrade(subscriptionData: SubscriptionData | null | undefined): boolean {
  const status = getSubscriptionStatus(subscriptionData)
  return status.plan === 'free' || status.plan === 'pro'
}

/**
 * Get the appropriate filled pill color based on usage thresholds.
 *
 * @param isCritical - Whether usage is at critical level (blocked or >= 90%)
 * @param isWarning - Whether usage is at warning level (>= 75% but < critical)
 * @returns CSS color value for filled pills
 */
export function getFilledPillColor(isCritical: boolean, isWarning: boolean): string {
  if (isCritical) return USAGE_PILL_COLORS.AT_LIMIT
  if (isWarning) return USAGE_PILL_COLORS.WARNING
  return USAGE_PILL_COLORS.FILLED
}
