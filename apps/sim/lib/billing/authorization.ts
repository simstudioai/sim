import { createLogger } from '@sim/logger'
import { hasPaidSubscription } from '@/lib/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'

const logger = createLogger('BillingAuthorization')

/**
 * Check if a user is authorized to manage billing for a given reference ID.
 * Reference ID can be either a user ID (personal subscription) or an
 * organization ID (org-scoped subscription — team, enterprise, or a
 * `pro_*` plan transferred to an org).
 *
 * This function also performs duplicate subscription validation for
 * organizations:
 * - Rejects if an organization already has an active subscription (prevents
 *   duplicates).
 * - Personal subscriptions skip this check to allow upgrades.
 */
export async function authorizeSubscriptionReference(
  userId: string,
  referenceId: string,
  action?: string
): Promise<boolean> {
  if (!isOrgScopedSubscription({ referenceId }, userId)) {
    return true
  }

  if (action === 'upgrade-subscription' && (await hasPaidSubscription(referenceId))) {
    logger.warn('Blocking checkout - active subscription already exists for organization', {
      userId,
      referenceId,
    })
    return false
  }

  return isOrganizationOwnerOrAdmin(userId, referenceId)
}
