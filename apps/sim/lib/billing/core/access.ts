import { db } from '@sim/db'
import { member, userStats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'

export interface EffectiveBillingStatus {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
}

/**
 * Gets the effective billing blocked status for a user.
 * If the user belongs to an organization, also checks whether the org owner is blocked.
 */
export async function getEffectiveBillingStatus(userId: string): Promise<EffectiveBillingStatus> {
  const userStatsRows = await db
    .select({
      blocked: userStats.billingBlocked,
      blockedReason: userStats.billingBlockedReason,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  const userBlocked = userStatsRows.length > 0 ? !!userStatsRows[0].blocked : false
  const userBlockedReason = userStatsRows.length > 0 ? userStatsRows[0].blockedReason : null

  if (userBlocked) {
    return {
      billingBlocked: true,
      billingBlockedReason: userBlockedReason,
      blockedByOrgOwner: false,
    }
  }

  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  const ownerResults = await Promise.all(
    memberships.map((m) =>
      db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, m.organizationId), eq(member.role, 'owner')))
        .limit(1)
    )
  )

  const otherOwnerIds = ownerResults
    .filter((owners) => owners.length > 0 && owners[0].userId !== userId)
    .map((owners) => owners[0].userId)

  if (otherOwnerIds.length > 0) {
    const ownerStatsResults = await Promise.all(
      otherOwnerIds.map((ownerId) =>
        db
          .select({
            blocked: userStats.billingBlocked,
            blockedReason: userStats.billingBlockedReason,
          })
          .from(userStats)
          .where(eq(userStats.userId, ownerId))
          .limit(1)
      )
    )

    for (const stats of ownerStatsResults) {
      if (stats.length > 0 && stats[0].blocked) {
        return {
          billingBlocked: true,
          billingBlockedReason: stats[0].blockedReason,
          blockedByOrgOwner: true,
        }
      }
    }
  }

  return {
    billingBlocked: false,
    billingBlockedReason: null,
    blockedByOrgOwner: false,
  }
}

export async function isOrganizationBillingBlocked(organizationId: string): Promise<boolean> {
  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  if (!owner) {
    return false
  }

  const [ownerStats] = await db
    .select({ blocked: userStats.billingBlocked })
    .from(userStats)
    .where(eq(userStats.userId, owner.userId))
    .limit(1)

  return !!ownerStats?.blocked
}
