import { db } from '@sim/db'
import {
  member,
  organizationMemberUsageLimit,
  permissions,
  usageLog,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { readLedgerBounded } from '@/lib/billing/core/ledger-read'
import { resolveSubscriptionUsagePeriod } from '@/lib/billing/core/reporting-period'
import type { UsageQueryPeriod } from '@/lib/billing/core/usage-log'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('OrgMemberLimits')

/**
 * Includes external collaborators whose explicit workspace access belongs to the organization.
 * Retained grants on archived workspaces still qualify so their caps remain manageable.
 * Mutations hold the organization fence before requesting a shared relationship lock;
 * together these stabilize workspace scope and access through the write.
 */
export async function isOrgMemberUsageLimitTarget(
  organizationId: string,
  userId: string,
  options: { executor?: DbOrTx; forShare?: boolean } = {}
): Promise<boolean> {
  const executor = options.executor ?? db
  const memberQuery = executor
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  const [organizationMember] = options.forShare ? await memberQuery.for('share') : await memberQuery
  if (organizationMember) return true

  const workspaceQuery = executor
    .select({ id: permissions.id })
    .from(permissions)
    .innerJoin(workspace, eq(workspace.id, permissions.entityId))
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(workspace.organizationId, organizationId)
      )
    )
    .limit(1)
  const [workspaceMember] = options.forShare
    ? await workspaceQuery.for('share', { of: permissions })
    : await workspaceQuery
  return Boolean(workspaceMember)
}

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
  billingPeriod: UsageQueryPeriod
): Promise<number> {
  const [row] = await readLedgerBounded(db, (tx) =>
    tx
      .select({ cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)` })
      .from(usageLog)
      .leftJoin(workspace, eq(workspace.id, usageLog.workspaceId))
      .where(
        and(
          eq(usageLog.userId, userId),
          ...(billingPeriod.source === 'reporting'
            ? [
                eq(usageLog.billingEntityType, 'organization'),
                eq(usageLog.billingEntityId, organizationId),
                gte(usageLog.createdAt, billingPeriod.start),
                lt(usageLog.createdAt, billingPeriod.end),
              ]
            : [
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
                ),
              ])
        )
      )
  )

  return Number.parseFloat(row?.cost ?? '0')
}

/**
 * Compute a member's current-period usage (dollars) against the organization
 * using the same reader enforcement uses, so admin/display surfaces can never
 * disagree with the cap check in {@link getOrgMemberUsageForBillingPeriod}.
 *
 * The current period is the org subscription window, falling back to the open
 * (all-time) window when the org has no resolvable period — matching how the
 * rest of the billing layer resolves a missing period.
 *
 * @param prefetchedSubscription - Pass an already-resolved org subscription
 *   (may be `null`) to skip the lookup. Omit to fetch it here.
 */
export async function getOrgMemberUsageForCurrentPeriod(
  organizationId: string,
  userId: string,
  prefetchedSubscription?: Awaited<ReturnType<typeof getOrganizationSubscription>>
): Promise<number> {
  const subscription =
    prefetchedSubscription === undefined
      ? await getOrganizationSubscription(organizationId)
      : prefetchedSubscription
  const billingPeriod = resolveSubscriptionUsagePeriod(subscription) ?? {
    ...defaultBillingPeriod(),
    source: 'default' as const,
  }

  return getOrgMemberUsageForBillingPeriod(organizationId, userId, billingPeriod)
}
