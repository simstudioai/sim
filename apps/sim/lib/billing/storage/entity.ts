import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'

/**
 * Converts a legacy user/subscription pair to the counter entity used by
 * storage internals.
 */
export function getLegacyStorageBillingEntity(
  userId: string,
  subscription: HighestPrioritySubscription | null
): BillingEntity {
  return isOrgScopedSubscription(subscription, userId) && subscription
    ? { type: 'organization', id: subscription.referenceId }
    : { type: 'user', id: userId }
}
