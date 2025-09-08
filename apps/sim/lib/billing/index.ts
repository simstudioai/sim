/**
 * Billing System - Main Entry Point
 * Provides clean, organized exports for the billing system
 */

export * from '@/lib/billing/calculations/usage-monitor'
export * from '@/lib/billing/core/billing'
export * from '@/lib/billing/core/organization'
export * from '@/lib/billing/core/subscription'
export {
  getHighestPrioritySubscription as getActiveSubscription,
  getUserSubscriptionState as getSubscriptionState,
  isEnterprisePlan as hasEnterprisePlan,
  isProPlan as hasProPlan,
  isTeamPlan as hasTeamPlan,
  sendPlanWelcomeEmail,
} from '@/lib/billing/core/subscription'
export * from '@/lib/billing/core/usage'
export {
  checkUsageStatus,
  getTeamUsageLimits,
  getUserUsageData as getUsageData,
  getUserUsageLimit as getUsageLimit,
  updateUserUsageLimit as updateUsageLimit,
} from '@/lib/billing/core/usage'
export * from '@/lib/billing/subscriptions/utils'
export { canEditUsageLimit as canEditLimit } from '@/lib/billing/subscriptions/utils'
export * from '@/lib/billing/types'
export * from '@/lib/billing/validation/seat-management'
