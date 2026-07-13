import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { hasPaidSubscription } from '@/lib/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import {
  assertNoUnresolvedEnterpriseIssuance,
  EnterpriseIssuanceInProgressError,
} from '@/lib/billing/enterprise-outbox'
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

  if (action === 'upgrade-subscription') {
    try {
      // This is an early checkout admission check, not the transactional
      // fence: canonical Sim-side entitlement conversion paths re-check under
      // the organization mutation lock before changing local billing state.
      await assertNoUnresolvedEnterpriseIssuance(db, referenceId)
    } catch (error) {
      if (!(error instanceof EnterpriseIssuanceInProgressError)) throw error
      logger.warn('Blocking checkout - Enterprise issuance is unfinished for organization', {
        userId,
        referenceId,
      })
      return false
    }
  }

  return isOrganizationOwnerOrAdmin(userId, referenceId)
}
