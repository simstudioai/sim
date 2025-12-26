import { db } from '@sim/db'
import { member, organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { Decimal, toDecimal, toFixedString, toNumber } from '@/lib/billing/utils/decimal'

const logger = createLogger('CreditBalance')

export interface CreditBalanceInfo {
  balance: number
  entityType: 'user' | 'organization'
  entityId: string
}

export async function getCreditBalance(userId: string): Promise<CreditBalanceInfo> {
  const subscription = await getHighestPrioritySubscription(userId)

  if (subscription?.plan === 'team' || subscription?.plan === 'enterprise') {
    const orgRows = await db
      .select({ creditBalance: organization.creditBalance })
      .from(organization)
      .where(eq(organization.id, subscription.referenceId))
      .limit(1)

    return {
      balance: orgRows.length > 0 ? toNumber(toDecimal(orgRows[0].creditBalance)) : 0,
      entityType: 'organization',
      entityId: subscription.referenceId,
    }
  }

  const userRows = await db
    .select({ creditBalance: userStats.creditBalance })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  return {
    balance: userRows.length > 0 ? toNumber(toDecimal(userRows[0].creditBalance)) : 0,
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
  const isTeamOrEnterprise = subscription?.plan === 'team' || subscription?.plan === 'enterprise'

  let creditsUsed: number

  if (isTeamOrEnterprise && subscription?.referenceId) {
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
      entityType: isTeamOrEnterprise ? 'organization' : 'user',
    })
  }

  return { creditsUsed, overflow }
}

export async function canPurchaseCredits(userId: string): Promise<boolean> {
  const subscription = await getHighestPrioritySubscription(userId)
  if (!subscription || subscription.status !== 'active') {
    return false
  }
  // Enterprise users must contact support to purchase credits
  return subscription.plan === 'pro' || subscription.plan === 'team'
}

export async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
  const memberRows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  if (memberRows.length === 0) return false
  return memberRows[0].role === 'owner' || memberRows[0].role === 'admin'
}
