import { db } from '@sim/db'
import { organizationMemberUsageLimit } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getOrgWorkspaceUsageCostForUser } from '@/lib/billing/core/usage-log'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'

const logger = createLogger('OrgMemberLimits')

/**
 * Read a member's per-organization usage limit (dollars). Returns `null` when no
 * cap is set for the `(organization, user)` pair — meaning only the pooled org
 * limit applies. Independent of `user_stats.current_usage_limit` (the user's
 * personal subscription cap), so it covers external members without clobbering
 * their personal limit.
 */
export async function getOrgMemberUsageLimit(
  organizationId: string,
  userId: string
): Promise<number | null> {
  const rows = await db
    .select({ usageLimit: organizationMemberUsageLimit.usageLimit })
    .from(organizationMemberUsageLimit)
    .where(
      and(
        eq(organizationMemberUsageLimit.organizationId, organizationId),
        eq(organizationMemberUsageLimit.userId, userId)
      )
    )
    .limit(1)

  if (rows.length === 0) return null
  return toNumber(toDecimal(rows[0].usageLimit))
}

/**
 * Upsert (or clear) a member's per-organization usage limit. Passing `null` for
 * `limitDollars` deletes the row, removing the per-member cap. The target need
 * not be an organization `member` row, so external members are supported.
 */
export async function setOrgMemberUsageLimit(
  organizationId: string,
  userId: string,
  limitDollars: number | null,
  setBy?: string
): Promise<void> {
  if (limitDollars === null) {
    await db
      .delete(organizationMemberUsageLimit)
      .where(
        and(
          eq(organizationMemberUsageLimit.organizationId, organizationId),
          eq(organizationMemberUsageLimit.userId, userId)
        )
      )
    logger.info('Cleared per-member usage limit', { organizationId, userId, setBy })
    return
  }

  await db
    .insert(organizationMemberUsageLimit)
    .values({
      id: generateId(),
      organizationId,
      userId,
      usageLimit: limitDollars.toString(),
      setBy: setBy ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [organizationMemberUsageLimit.organizationId, organizationMemberUsageLimit.userId],
      set: {
        usageLimit: limitDollars.toString(),
        setBy: setBy ?? null,
        updatedAt: new Date(),
      },
    })

  logger.info('Set per-member usage limit', { organizationId, userId, limitDollars, setBy })
}

/**
 * Compute a member's current-period usage (dollars) inside the organization's
 * own workspaces.
 *
 * Sums `usage_log` by `created_at` within the org subscription window across the
 * org's workspaces, scoped to the given user (a single indexed aggregation — see
 * {@link getOrgWorkspaceUsageCostForUser}). Filtering by workspace (not billing
 * entity) is what captures external members and mothership/copilot cost. Raw
 * usage — daily-refresh credits are a pooled concept and intentionally not
 * deducted here.
 *
 * Throws if the org has no resolvable billing-period window. This path is only
 * reached for a hosted, billing-enabled org with a per-member cap set, which by
 * construction must have a subscription — so a missing window is an invariant
 * violation, not a normal state. We fail loudly rather than silently falling
 * back to an all-time window (which would over-count usage and wrongly block).
 */
export async function getOrgMemberWorkspaceUsage(
  organizationId: string,
  userId: string
): Promise<number> {
  const subscription = await getOrganizationSubscription(organizationId)
  if (!subscription?.periodStart || !subscription?.periodEnd) {
    throw new Error(
      `Cannot resolve billing period for organization ${organizationId}: missing or incomplete subscription. Per-member usage cannot be computed.`
    )
  }

  return getOrgWorkspaceUsageCostForUser(organizationId, userId, {
    start: subscription.periodStart,
    end: subscription.periodEnd,
  })
}
