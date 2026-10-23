import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import type { DbClient } from '@/lib/db/types'

const logger = createLogger('CreditBalance')

export interface CreditBalanceInfo {
  balance: number
  entityType: 'user' | 'organization'
  entityId: string
}

/**
 * Read credit balance directly from a known entity (user or organization).
 * Use this in webhook / admin paths that already know the target entity —
 * unlike `getCreditBalance(userId)` it does not route through
 * `getHighestPrioritySubscription`, so callers don't need to resolve the
 * org owner as a user-id proxy.
 */
export async function getCreditBalanceForEntity(
  entityType: 'user' | 'organization',
  entityId: string,
  executor: DbClient = db
): Promise<number> {
  if (entityType === 'organization') {
    const rows = await executor
      .select({ creditBalance: organization.creditBalance })
      .from(organization)
      .where(eq(organization.id, entityId))
      .limit(1)
    return rows.length > 0 ? toNumber(toDecimal(rows[0].creditBalance)) : 0
  }

  const rows = await executor
    .select({ creditBalance: userStats.creditBalance })
    .from(userStats)
    .where(eq(userStats.userId, entityId))
    .limit(1)
  return rows.length > 0 ? toNumber(toDecimal(rows[0].creditBalance)) : 0
}

export async function getCreditBalance(
  userId: string,
  executor: DbClient = db
): Promise<CreditBalanceInfo> {
  const subscription = await getHighestPrioritySubscription(userId, { executor })

  if (isOrgScopedSubscription(subscription, userId) && subscription) {
    return {
      balance: await getCreditBalanceForEntity('organization', subscription.referenceId, executor),
      entityType: 'organization',
      entityId: subscription.referenceId,
    }
  }

  return {
    balance: await getCreditBalanceForEntity('user', userId, executor),
    entityType: 'user',
    entityId: userId,
  }
}

export async function addCredits(
  entityType: 'user' | 'organization',
  entityId: string,
  amount: number
): Promise<void> {
  if (entityType === 'organization') {
    await db
      .update(organization)
      .set({ creditBalance: sql`${organization.creditBalance} + ${amount}` })
      .where(eq(organization.id, entityId))

    logger.info('Added credits to organization', { organizationId: entityId, amount })
  } else {
    await db
      .update(userStats)
      .set({ creditBalance: sql`${userStats.creditBalance} + ${amount}` })
      .where(eq(userStats.userId, entityId))

    logger.info('Added credits to user', { userId: entityId, amount })
  }
}
