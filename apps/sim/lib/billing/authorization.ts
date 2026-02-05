import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { hasActiveSubscription } from '@/lib/billing'

const logger = createLogger('BillingAuthorization')

/**
 * Check if a user is authorized to manage billing for a given reference ID
 * Reference ID can be either a user ID (individual subscription) or organization ID (team subscription)
 *
 * This function also performs duplicate subscription validation for organizations:
 * - Rejects if an organization already has an active subscription (prevents duplicates)
 * - Personal subscriptions (referenceId === userId) skip this check to allow upgrades
 */
export async function authorizeSubscriptionReference(
  userId: string,
  referenceId: string
): Promise<boolean> {
  // User can always manage their own subscriptions (Pro upgrades, etc.)
  if (referenceId === userId) {
    return true
  }

  // For organizations: check for existing active subscriptions to prevent duplicates
  if (await hasActiveSubscription(referenceId)) {
    logger.warn('Blocking checkout - active subscription already exists for organization', {
      userId,
      referenceId,
    })
    return false
  }

  // Check if referenceId is an organizationId the user has admin rights to
  const members = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, referenceId)))

  const member = members[0]

  // Allow if the user is an owner or admin of the organization
  return member?.role === 'owner' || member?.role === 'admin'
}
