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

const logger = createLogger('DailyRefresh')

const MS_PER_DAY = 86_400_000

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
export async function computeDailyRefreshConsumed(params: {
  userIds: string[]
  periodStart: Date
  periodEnd?: Date | null
  planDollars: number
  seats?: number
  userBounds?: Record<string, PerUserBounds>
}): Promise<number> {
  const { userIds, periodStart, periodEnd, planDollars, seats = 1, userBounds } = params

  if (planDollars <= 0 || userIds.length === 0) return 0

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * seats

  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now

  if (cap <= periodStart) return 0

  const dayCount = Math.ceil((cap.getTime() - periodStart.getTime()) / MS_PER_DAY)
  if (dayCount <= 0) return 0

  const unboundedUsers = userBounds ? userIds.filter((id) => !(id in userBounds)) : userIds

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
            gte(usageLog.createdAt, periodStart),
            lt(usageLog.createdAt, cap)
          ),
          ...boundedClauses,
        ]
      : boundedClauses

  if (rowFilters.length === 0) return 0

  const rows = await db
    .select({
      dayIndex:
        sql<number>`FLOOR((EXTRACT(EPOCH FROM ${usageLog.createdAt}) - ${Math.floor(periodStart.getTime() / 1000)}) / 86400)`.as(
          'day_index'
        ),
      dayTotal: sum(usageLog.cost).as('day_total'),
    })
    .from(usageLog)
    .where(rowFilters.length === 1 ? rowFilters[0] : or(...rowFilters))
    .groupBy(sql`day_index`)

  let totalConsumed = 0
  for (const row of rows) {
    const dayUsage = Number.parseFloat(row.dayTotal ?? '0')
    totalConsumed += Math.min(dayUsage, dailyRefreshDollars)
  }

  logger.debug('Daily refresh computed', {
    userCount: userIds.length,
    periodStart: periodStart.toISOString(),
    days: dayCount,
    dailyRefreshDollars,
    totalConsumed,
    hasUserBounds: Boolean(userBounds),
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
  periodStart: Date
): Promise<Record<string, { userStart: Date }>> {
  const rows = await db
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
