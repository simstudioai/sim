import { db } from '@sim/db'
import { organizationMemberUsageLimit } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
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
 * When the org has no resolvable subscription window, falls back to the open
 * (all-time) window, matching how the rest of the billing layer resolves a
 * missing period (e.g. {@link deriveBillingContext}, the pooled-org and user
 * usage paths). A hosted org with a per-member cap normally has a period, so
 * this fallback is an edge case; using the shared convention keeps this path
 * consistent with every other usage read rather than special-casing it.
 */
export async function getOrgMemberWorkspaceUsage(
  organizationId: string,
  userId: string
): Promise<number> {
  const subscription = await getOrganizationSubscription(organizationId)
  const billingPeriod =
    subscription?.periodStart && subscription.periodEnd
      ? { start: subscription.periodStart, end: subscription.periodEnd }
      : defaultBillingPeriod()

  return getOrgWorkspaceUsageCostForUser(organizationId, userId, billingPeriod)
}
