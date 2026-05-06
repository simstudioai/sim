import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { getEffectiveBillingStatus } from '@/lib/billing/core/access'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPro, isTeam } from '@/lib/billing/plan-helpers'
import {
  hasUsableSubscriptionAccess,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import { Decimal, toDecimal, toFixedString, toNumber } from '@/lib/billing/utils/decimal'

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
  entityId: string
): Promise<number> {
  if (entityType === 'organization') {
    const rows = await db
      .select({ creditBalance: organization.creditBalance })
      .from(organization)
      .where(eq(organization.id, entityId))
      .limit(1)
    return rows.length > 0 ? toNumber(toDecimal(rows[0].creditBalance)) : 0
  }

  const rows = await db
    .select({ creditBalance: userStats.creditBalance })
    .from(userStats)
    .where(eq(userStats.userId, entityId))
    .limit(1)
  return rows.length > 0 ? toNumber(toDecimal(rows[0].creditBalance)) : 0
}

export async function getCreditBalance(userId: string): Promise<CreditBalanceInfo> {
  const subscription = await getHighestPrioritySubscription(userId)

  if (isOrgScopedSubscription(subscription, userId) && subscription) {
    return {
      balance: await getCreditBalanceForEntity('organization', subscription.referenceId),
      entityType: 'organization',
      entityId: subscription.referenceId,
    }
  }

  return {
    balance: await getCreditBalanceForEntity('user', userId),
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

export async function removeCredits(
  entityType: 'user' | 'organization',
  entityId: string,
  amount: number
): Promise<void> {
  if (entityType === 'organization') {
    await db
      .update(organization)
      .set({ creditBalance: sql`GREATEST(0, ${organization.creditBalance} - ${amount})` })
      .where(eq(organization.id, entityId))

    logger.info('Removed credits from organization', { organizationId: entityId, amount })
  } else {
    await db
      .update(userStats)
      .set({ creditBalance: sql`GREATEST(0, ${userStats.creditBalance} - ${amount})` })
      .where(eq(userStats.userId, entityId))

    logger.info('Removed credits from user', { userId: entityId, amount })
  }
}

export interface DeductResult {
  creditsUsed: number
  overflow: number
}

async function atomicDeductUserCredits(userId: string, cost: number): Promise<number> {
  const costDecimal = toDecimal(cost)
  const costStr = toFixedString(costDecimal)

  // Use raw SQL with CTE to capture old balance before update
  const result = await db.execute<{ old_balance: string; new_balance: string }>(sql`
    WITH old_balance AS (
      SELECT credit_balance FROM user_stats WHERE user_id = ${userId}
    )
    UPDATE user_stats
    SET credit_balance = CASE
      WHEN credit_balance >= ${costStr}::decimal THEN credit_balance - ${costStr}::decimal
      ELSE 0
    END
    WHERE user_id = ${userId} AND credit_balance >= 0
    RETURNING
      (SELECT credit_balance FROM old_balance) as old_balance,
      credit_balance as new_balance
  `)

  const rows = Array.from(result)
  if (rows.length === 0) return 0

  const oldBalance = toDecimal(rows[0].old_balance)
  return toNumber(oldBalance.lessThan(costDecimal) ? oldBalance : costDecimal)
}

async function atomicDeductOrgCredits(orgId: string, cost: number): Promise<number> {
  const costDecimal = toDecimal(cost)
  const costStr = toFixedString(costDecimal)

  // Use raw SQL with CTE to capture old balance before update
  const result = await db.execute<{ old_balance: string; new_balance: string }>(sql`
    WITH old_balance AS (
      SELECT credit_balance FROM organization WHERE id = ${orgId}
    )
    UPDATE organization
    SET credit_balance = CASE
      WHEN credit_balance >= ${costStr}::decimal THEN credit_balance - ${costStr}::decimal
      ELSE 0
    END
    WHERE id = ${orgId} AND credit_balance >= 0
    RETURNING
      (SELECT credit_balance FROM old_balance) as old_balance,
      credit_balance as new_balance
  `)

  const rows = Array.from(result)
  if (rows.length === 0) return 0

  const oldBalance = toDecimal(rows[0].old_balance)
  return toNumber(oldBalance.lessThan(costDecimal) ? oldBalance : costDecimal)
}

export async function deductFromCredits(userId: string, cost: number): Promise<DeductResult> {
  if (cost <= 0) {
    return { creditsUsed: 0, overflow: 0 }
  }

  const subscription = await getHighestPrioritySubscription(userId)
  const orgScoped = isOrgScopedSubscription(subscription, userId)

  let creditsUsed: number

  if (orgScoped && subscription?.referenceId) {
    creditsUsed = await atomicDeductOrgCredits(subscription.referenceId, cost)
  } else {
    creditsUsed = await atomicDeductUserCredits(userId, cost)
  }

  const overflow = toNumber(Decimal.max(0, toDecimal(cost).minus(creditsUsed)))

  if (creditsUsed > 0) {
    logger.info('Deducted credits atomically', {
      userId,
      creditsUsed,
      overflow,
      entityType: orgScoped ? 'organization' : 'user',
    })
  }

  return { creditsUsed, overflow }
}

export async function canPurchaseCredits(userId: string): Promise<boolean> {
  const subscription = await getHighestPrioritySubscription(userId)
  if (!subscription) {
    return false
  }
  const billingStatus = await getEffectiveBillingStatus(userId)
  if (!hasUsableSubscriptionAccess(subscription.status, billingStatus.billingBlocked)) {
    return false
  }
  // Enterprise users must contact support to purchase credits
  return isPro(subscription.plan) || isTeam(subscription.plan)
}
