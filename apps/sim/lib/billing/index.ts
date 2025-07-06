/**
 * Billing System - Main Entry Point
 * Provides clean, organized exports for the billing system
 */

// Calculations and monitoring
export * from './calculations/usage-monitor'
// Simplified billing system
export * from './core/billing'
export * from './core/billing-periods'
export * from './core/organization-billing'
// Core functionality
export * from './core/subscription'
// Re-export commonly used functions with cleaner names
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
// Utilities
export * from './subscriptions/utils'
// Convenience exports for common operations
export {
  calculateDefaultUsageLimit as getDefaultLimit,
  canEditUsageLimit as canEditLimit,
  getMinimumUsageLimit as getMinimumLimit,
} from './subscriptions/utils'
// Types
export * from './types'
// Validation
export * from './validation/seat-management'
