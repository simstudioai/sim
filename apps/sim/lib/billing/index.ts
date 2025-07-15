/**
 * Billing System - Main Entry Point
 * Provides clean, organized exports for the billing system
 */

export * from './calculations/usage-monitor'
export * from './core/billing'
export * from './core/billing-periods'
export * from './core/organization-billing'
export * from './core/subscription'
export {
  getHighestPrioritySubscription as getActiveSubscription,
  getUserSubscriptionState as getSubscriptionState,
  isEnterprisePlan as hasEnterprisePlan,
  isProPlan as hasProPlan,
  isTeamPlan as hasTeamPlan,
} from './core/subscription'
export * from './core/usage'
export {
  checkUsageStatus,
  getTeamUsageLimits,
  getUserUsageData as getUsageData,
  getUserUsageLimit as getUsageLimit,
  updateUserUsageLimit as updateUsageLimit,
} from './core/usage'
export * from './subscriptions/utils'
export {
  calculateDefaultUsageLimit as getDefaultLimit,
  canEditUsageLimit as canEditLimit,
  getMinimumUsageLimit as getMinimumLimit,
} from './subscriptions/utils'
export * from './types'
export * from './validation/seat-management'
