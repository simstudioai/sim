import { db } from '@sim/db'
import { member, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'

const logger = createLogger('BillingAccess')

export interface EffectiveBillingStatus {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
}

export interface BillingEntityBlockStatus {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
}

/**
 * Reads one user's own `user_stats` row, without re-deriving the block that
 * their organization membership would imply.
 *
 * Only the organization branch of {@link getBillingEntityBlockStatus} wants this
 * narrow read: an organization's debt is its owner's own debt, and some other
 * org the owner merely belongs to is not this organization's problem. Callers
 * asking whether a *user* is blocked want {@link getEffectiveBillingStatus}.
 */
async function getUserStatsBlockStatus(userId: string): Promise<BillingEntityBlockStatus> {
  const [stats] = await db
    .select({
      billingBlocked: userStats.billingBlocked,
      billingBlockedReason: userStats.billingBlockedReason,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  const billingBlocked = Boolean(stats?.billingBlocked)
  return {
    billingBlocked,
    billingBlockedReason: billingBlocked ? (stats?.billingBlockedReason ?? null) : null,
  }
}

/**
 * Reads the effective block state of one payer, personal or organization.
 *
 * A personal payer resolves through {@link getEffectiveBillingStatus}, so a
 * delinquent organization blocks its members on their personal resources too.
 * That is the policy `blockOrgMembers` already writes; re-deriving it here
 * instead of trusting the fan-out is what keeps the read correct for a member
 * who joined *after* the block landed and whose own row was never marked.
 *
 * Every gate that asks "is this payer blocked?" must come through here or
 * {@link getEffectiveBillingStatus}. A direct `userStats.billingBlocked` select
 * answers a narrower question and will disagree with them.
 */
export async function getBillingEntityBlockStatus(billingEntity: {
  type: 'user' | 'organization'
  id: string
}): Promise<BillingEntityBlockStatus> {
  if (billingEntity.type === 'user') {
    const { billingBlocked, billingBlockedReason } = await getEffectiveBillingStatus(
      billingEntity.id
    )
    return { billingBlocked, billingBlockedReason }
  }

  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, billingEntity.id), eq(member.role, 'owner')))
    .limit(1)

  if (!owner) {
    logger.error(
      'Organization has no owner when checking billing-blocked state — data integrity issue',
      { organizationId: billingEntity.id }
    )
    return { billingBlocked: false, billingBlockedReason: null }
  }

  return getUserStatsBlockStatus(owner.userId)
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
  const status = await getBillingEntityBlockStatus({ type: 'organization', id: organizationId })
  return status.billingBlocked
}
