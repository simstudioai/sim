/**
 * Daily Refresh Credits
 *
 * Each billing period is divided into 1-day windows starting from `periodStart`.
 * Users receive `planDollars * DAILY_REFRESH_RATE` in "included" usage per day.
 * Usage within that allowance does not count toward the plan limit (use-it-or-lose-it).
 *
 * The total refresh consumed in a period is:
 *   SUM( MIN(day_usage, daily_refresh_amount) ) for each day
 *
 * This is subtracted from `currentPeriodCost` to derive "effective billable usage".
 */

import { db } from '@sim/db'
import { member, usageLog, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, inArray, lt, or, sql, sum } from 'drizzle-orm'
import { DAILY_REFRESH_RATE } from '@/lib/billing/constants'
import { dayIndexSql, MS_PER_DAY, readUsageDailyTotals } from '@/lib/billing/core/usage-daily-total'
import type { DbClient } from '@/lib/db/types'

const logger = createLogger('DailyRefresh')

/**
 * Applies the per-day allowance cap and totals the result.
 *
 * The "MIN(day usage, allowance) per day" rule is the whole point of bucketing
 * by day, and both the rollup and the ledger paths reduce to the same thing —
 * an iterable of per-day totals — so the rule lives here once rather than
 * being spelled out on each path.
 */
function sumCappedDays(dayTotals: Iterable<number>, dailyRefreshDollars: number): number {
  let total = 0
  for (const dayUsage of dayTotals) {
    total += Math.min(dayUsage, dailyRefreshDollars)
  }
  return total
}

/**
 * Optional per-user date window. `usageLog` rows outside
 * `[userStart, userEnd)` are excluded from that user's contribution.
 * Used to slice refresh around a mid-cycle org join so pre-join and
 * post-join refresh are billed by the right subscription.
 */
export interface PerUserBounds {
  userStart?: Date | null
  userEnd?: Date | null
}

/**
 * Compute the total daily refresh credits consumed in the current billing period
 * using a single aggregating SQL query grouped by day offset.
 *
 * For each day from `periodStart`:
 *   consumed_today = MIN(actual_usage_today, daily_refresh_dollars)
 *
 * @returns Total dollars of refresh consumed across all days (to subtract from usage)
 */
export async function computeDailyRefreshConsumed(
  params: {
    userIds: string[]
    periodStart: Date
    periodEnd?: Date | null
    planDollars: number
    seats?: number
    userBounds?: Record<string, PerUserBounds>
    billingEntity?: { type: 'user' | 'organization'; id: string }
  },
  executor: DbClient = db
): Promise<number> {
  const {
    userIds,
    periodStart,
    periodEnd,
    planDollars,
    seats = 1,
    userBounds,
    billingEntity,
  } = params

  if (planDollars <= 0 || userIds.length === 0) return 0

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * seats

  const now = new Date()
  const periodIsOpen = !periodEnd || periodEnd >= now
  const cap = periodIsOpen ? now : periodEnd

  if (cap <= periodStart) return 0

  const dayCount = Math.ceil((cap.getTime() - periodStart.getTime()) / MS_PER_DAY)
  if (dayCount <= 0) return 0

  const hasPerUserBounds = Boolean(userBounds && Object.keys(userBounds).length > 0)

  /**
   * The rollup can answer this exactly only when every row the ledger query
   * would match falls wholly inside a day bucket it maintains:
   *
   * - `billingEntity` must be set, since the rollup is keyed by it. Without it
   *   the ledger query spans every entity a user has billed against.
   * - No per-user bounds, whose `userStart`/`userEnd` are arbitrary instants
   *   that can cut a bucket in half.
   * - The period must still be open. A closed period caps at `periodEnd`, and
   *   a ledger row can be stamped to a period yet created after it ends (a
   *   late flush), which the ledger query excludes and the bucket would not.
   *
   * Anything else falls through to aggregating the ledger, unchanged — as does
   * a rollup that has no buckets for this period yet, or that has reads off.
   */
  if (billingEntity && periodIsOpen && !hasPerUserBounds) {
    const daily = await readUsageDailyTotals(billingEntity, periodStart, userIds, executor)
    if (daily) {
      const totalConsumed = sumCappedDays(daily.values(), dailyRefreshDollars)
      logger.debug('Daily refresh computed', {
        userCount: userIds.length,
        periodStart: periodStart.toISOString(),
        days: dayCount,
        dailyRefreshDollars,
        totalConsumed,
        source: 'rollup',
      })
      return totalConsumed
    }
  }

  const unboundedUsers = userBounds ? userIds.filter((id) => !(id in userBounds)) : userIds
  const billingEntityFilter = billingEntity
    ? and(
        eq(usageLog.billingEntityType, billingEntity.type),
        eq(usageLog.billingEntityId, billingEntity.id),
        eq(usageLog.billingPeriodStart, periodStart)
      )
    : undefined

  const boundedClauses = userBounds
    ? Object.entries(userBounds).flatMap(([userId, bounds]) => {
        if (!userIds.includes(userId)) return []
        const effectiveStart =
          bounds.userStart && bounds.userStart > periodStart ? bounds.userStart : periodStart
        const effectiveEnd = bounds.userEnd && bounds.userEnd < cap ? bounds.userEnd : cap
        if (effectiveEnd <= effectiveStart) return []
        return [
          and(
            eq(usageLog.userId, userId),
            billingEntityFilter,
            gte(usageLog.createdAt, effectiveStart),
            lt(usageLog.createdAt, effectiveEnd)
          ),
        ]
      })
    : []

  const rowFilters =
    unboundedUsers.length > 0
      ? [
          and(
            inArray(usageLog.userId, unboundedUsers),
            billingEntityFilter,
            gte(usageLog.createdAt, periodStart),
            lt(usageLog.createdAt, cap)
          ),
          ...boundedClauses,
        ]
      : boundedClauses

  if (rowFilters.length === 0) return 0

  const rows = await executor
    .select({
      dayIndex: dayIndexSql(usageLog.createdAt, periodStart).as('day_index'),
      dayTotal: sum(usageLog.cost).as('day_total'),
    })
    .from(usageLog)
    .where(rowFilters.length === 1 ? rowFilters[0] : or(...rowFilters))
    .groupBy(sql`day_index`)

  const totalConsumed = sumCappedDays(
    rows.map((row) => Number.parseFloat(row.dayTotal ?? '0')),
    dailyRefreshDollars
  )

  logger.debug('Daily refresh computed', {
    userCount: userIds.length,
    periodStart: periodStart.toISOString(),
    days: dayCount,
    dailyRefreshDollars,
    totalConsumed,
    hasUserBounds: hasPerUserBounds,
    source: 'ledger',
  })

  return totalConsumed
}

/**
 * Get the daily refresh allowance in dollars for a plan.
 */
export function getDailyRefreshDollars(planDollars: number): number {
  return planDollars * DAILY_REFRESH_RATE
}

export async function getOrgMemberRefreshBounds(
  organizationId: string,
  periodStart: Date,
  executor: DbClient = db
): Promise<Record<string, { userStart: Date }>> {
  const rows = await executor
    .select({
      userId: member.userId,
      snapshotAt: userStats.proPeriodCostSnapshotAt,
    })
    .from(member)
    .leftJoin(userStats, eq(member.userId, userStats.userId))
    .where(eq(member.organizationId, organizationId))

  const bounds: Record<string, { userStart: Date }> = {}
  for (const row of rows) {
    if (row.snapshotAt && row.snapshotAt > periodStart) {
      bounds[row.userId] = { userStart: row.snapshotAt }
    }
  }
  return bounds
}
