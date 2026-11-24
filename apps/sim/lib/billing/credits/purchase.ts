import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { PRO_TRIAL_USAGE_LIMIT_DOLLARS } from '@/lib/billing/constants'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { isTrialingSubscription } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'

const logger = createLogger('CreditPurchase')

/**
 * Sets usage limit to planBase + creditBalance.
 * This ensures users can use their plan's included amount plus any prepaid credits. A personal
 * trial's base is its fixed allowance, not the plan's.
 */
export async function setUsageLimitForCredits(
  entityType: 'user' | 'organization',
  entityId: string,
  subscription: { plan: string; status: string | null; billingInterval?: string | null },
  seats: number | null,
  creditBalance: number
): Promise<void> {
  try {
    const basePrice =
      entityType === 'user' && isTrialingSubscription(subscription)
        ? PRO_TRIAL_USAGE_LIMIT_DOLLARS
        : getPlanPricing(subscription).basePrice

    const seatCount = seats || 1
    const planBase =
      entityType === 'organization' ? Number(basePrice) * seatCount : Number(basePrice)
    const creditBalanceNum = Number(creditBalance)
    const newLimit = planBase + creditBalanceNum

    if (entityType === 'organization') {
      const orgRows = await db
        .select({ orgUsageLimit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, entityId))
        .limit(1)

      const currentLimit = orgRows.length > 0 ? toNumber(toDecimal(orgRows[0].orgUsageLimit)) : 0

      if (newLimit > currentLimit) {
        await db
          .update(organization)
          .set({ orgUsageLimit: newLimit.toString() })
          .where(eq(organization.id, entityId))

        logger.info('Set org usage limit to planBase + credits', {
          organizationId: entityId,
          plan: subscription.plan,
          seats,
          planBase,
          creditBalance,
          previousLimit: currentLimit,
          newLimit,
        })
      }
    } else {
      const userStatsRows = await db
        .select({ currentUsageLimit: userStats.currentUsageLimit })
        .from(userStats)
        .where(eq(userStats.userId, entityId))
        .limit(1)

      const currentLimit =
        userStatsRows.length > 0 ? toNumber(toDecimal(userStatsRows[0].currentUsageLimit)) : 0

      if (newLimit > currentLimit) {
        await db
          .update(userStats)
          .set({ currentUsageLimit: newLimit.toString() })
          .where(eq(userStats.userId, entityId))

        logger.info('Set user usage limit to planBase + credits', {
          userId: entityId,
          plan: subscription.plan,
          planBase,
          creditBalance,
          previousLimit: currentLimit,
          newLimit,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to set usage limit for credits', { entityType, entityId, error })
  }
}
