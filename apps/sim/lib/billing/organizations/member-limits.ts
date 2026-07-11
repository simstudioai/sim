import { db } from '@sim/db'
import { organizationMemberUsageLimit, usageLog, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getOrgWorkspaceUsageCostForUser } from '@/lib/billing/core/usage-log'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import type { DbOrTx } from '@/lib/db/types'

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
  setBy?: string,
  executor: DbOrTx = db
): Promise<void> {
  if (limitDollars === null) {
    await executor
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

  await executor
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
 * Sums an actor's usage against an immutable organization attribution snapshot
 * plus disjoint legacy rows that predate billing attribution.
 *
 * New rows use the captured organization and period directly. Legacy rows with
 * null billing attribution may use the workspace join only after that workspace
 * was assigned to the organization. The branches are disjoint, so an attributed
 * row can never be counted again through mutable workspace ownership.
 */
export async function getOrgMemberUsageForBillingPeriod(
  organizationId: string,
  userId: string,
  billingPeriod: { start: Date; end: Date }
): Promise<number> {
  const [row] = await db
    .select({ cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)` })
    .from(usageLog)
    .leftJoin(workspace, eq(workspace.id, usageLog.workspaceId))
    .where(
      and(
        eq(usageLog.userId, userId),
        or(
          and(
            eq(usageLog.billingEntityType, 'organization'),
            eq(usageLog.billingEntityId, organizationId),
            eq(usageLog.billingPeriodStart, billingPeriod.start),
            eq(usageLog.billingPeriodEnd, billingPeriod.end)
          ),
          and(
            isNull(usageLog.billingEntityType),
            isNull(usageLog.billingEntityId),
            eq(workspace.organizationId, organizationId),
            or(
              isNull(workspace.organizationAssignedAt),
              gte(usageLog.createdAt, workspace.organizationAssignedAt)
            ),
            gte(usageLog.createdAt, billingPeriod.start),
            lt(usageLog.createdAt, billingPeriod.end)
          )
        )
      )
    )

  return Number.parseFloat(row?.cost ?? '0')
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
