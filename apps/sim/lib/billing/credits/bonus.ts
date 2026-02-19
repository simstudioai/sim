import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('BonusCredits')

/**
 * Apply bonus credits to a user (e.g. referral bonuses, promotional codes).
 *
 * Detects the user's current plan and routes credits accordingly:
 * - Free/Pro: adds to `userStats.creditBalance` and increments `currentUsageLimit`
 * - Team/Enterprise: adds to `organization.creditBalance` and increments `orgUsageLimit`
 *
 * Uses direct increment (not recalculation) so it works correctly for free-tier
 * users where `setUsageLimitForCredits` would compute planBase=0 and skip the update.
 *
 * @param tx - Optional Drizzle transaction context. When provided, all DB writes
 *             participate in the caller's transaction for atomicity.
 */
export async function applyBonusCredits(
  userId: string,
  amount: number,
  tx?: DbOrTx
): Promise<void> {
  const dbCtx = tx ?? db
  const subscription = await getHighestPrioritySubscription(userId)
  const isTeamOrEnterprise = subscription?.plan === 'team' || subscription?.plan === 'enterprise'

  if (isTeamOrEnterprise && subscription?.referenceId) {
    const orgId = subscription.referenceId

    await dbCtx
      .update(organization)
      .set({
        creditBalance: sql`${organization.creditBalance} + ${amount}`,
        orgUsageLimit: sql`COALESCE(${organization.orgUsageLimit}, '0')::decimal + ${amount}`,
      })
      .where(eq(organization.id, orgId))

    logger.info('Applied bonus credits to organization', {
      userId,
      organizationId: orgId,
      plan: subscription.plan,
      amount,
    })
  } else {
    await dbCtx
      .update(userStats)
      .set({
        creditBalance: sql`${userStats.creditBalance} + ${amount}`,
        currentUsageLimit: sql`COALESCE(${userStats.currentUsageLimit}, '0')::decimal + ${amount}`,
      })
      .where(eq(userStats.userId, userId))

    logger.info('Applied bonus credits to user', {
      userId,
      plan: subscription?.plan || 'free',
      amount,
    })
  }
}
