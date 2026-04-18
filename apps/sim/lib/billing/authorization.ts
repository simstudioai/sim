import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { hasPaidSubscription } from '@/lib/billing'
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
  // `isOrgScopedSubscription` returns `false` when referenceId === userId,
  // which is exactly the "personal subscription" case we want to allow
  // without further checks.
  if (!isOrgScopedSubscription({ referenceId }, userId)) {
    return true
  }

  // Only block duplicate subscriptions during upgrade/checkout, not cancel/restore/list
  if (action === 'upgrade-subscription' && (await hasPaidSubscription(referenceId))) {
    logger.warn('Blocking checkout - active subscription already exists for organization', {
      userId,
      referenceId,
    })
    return false
  }

  const members = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, referenceId)))

  const member = members[0]

  return member?.role === 'owner' || member?.role === 'admin'
}
