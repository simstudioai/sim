import { db } from '@sim/db'
import { member, organization, userStats } from '@sim/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console/logger'

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
      balance: orgRows.length > 0 ? Number.parseFloat(orgRows[0].creditBalance || '0') : 0,
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
    balance: userRows.length > 0 ? Number.parseFloat(userRows[0].creditBalance || '0') : 0,
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
  const costStr = cost.toFixed(6)

  const result = await db
    .update(userStats)
    .set({
      creditBalance: sql`CASE 
        WHEN ${userStats.creditBalance} >= ${costStr}::decimal THEN ${userStats.creditBalance} - ${costStr}::decimal
        ELSE 0
      END`,
    })
    .where(and(eq(userStats.userId, userId), gte(userStats.creditBalance, '0')))
    .returning({
      oldBalance: sql<string>`(SELECT credit_balance FROM user_stats WHERE user_id = ${userId})`,
    })

  if (result.length === 0) return 0

  const oldBalance = Number.parseFloat(result[0].oldBalance || '0')
  return Math.min(oldBalance, cost)
}

async function atomicDeductOrgCredits(orgId: string, cost: number): Promise<number> {
  const costStr = cost.toFixed(6)

  const result = await db
    .update(organization)
    .set({
      creditBalance: sql`CASE 
        WHEN ${organization.creditBalance} >= ${costStr}::decimal THEN ${organization.creditBalance} - ${costStr}::decimal
        ELSE 0
      END`,
    })
    .where(and(eq(organization.id, orgId), gte(organization.creditBalance, '0')))
    .returning({
      oldBalance: sql<string>`(SELECT credit_balance FROM organization WHERE id = ${orgId})`,
    })

  if (result.length === 0) return 0

  const oldBalance = Number.parseFloat(result[0].oldBalance || '0')
  return Math.min(oldBalance, cost)
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

  const overflow = Math.max(0, cost - creditsUsed)

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
  return (
    subscription.plan === 'pro' ||
    subscription.plan === 'team' ||
    subscription.plan === 'enterprise'
  )
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
