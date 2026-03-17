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
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, gte, inArray, lt, sql, sum } from 'drizzle-orm'
import { DAILY_REFRESH_RATE } from '@/lib/billing/constants'

const logger = createLogger('DailyRefresh')

const MS_PER_DAY = 86_400_000

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
}): Promise<number> {
  const { userIds, periodStart, periodEnd, planDollars, seats = 1 } = params

  if (planDollars <= 0 || userIds.length === 0) return 0

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * seats

  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now

  if (cap <= periodStart) return 0

  const dayCount = Math.ceil((cap.getTime() - periodStart.getTime()) / MS_PER_DAY)
  if (dayCount <= 0) return 0

  const rows = await db
    .select({
      dayIndex:
        sql<number>`FLOOR((EXTRACT(EPOCH FROM ${usageLog.createdAt}) - ${Math.floor(periodStart.getTime() / 1000)}) / 86400)`.as(
          'day_index'
        ),
      dayTotal: sum(usageLog.cost).as('day_total'),
    })
    .from(usageLog)
    .where(
      and(
        inArray(usageLog.userId, userIds),
        gte(usageLog.createdAt, periodStart),
        lt(usageLog.createdAt, cap)
      )
    )
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
  })

  return totalConsumed
}

/**
 * Get the daily refresh allowance in dollars for a plan.
 */
export function getDailyRefreshDollars(planDollars: number): number {
  return planDollars * DAILY_REFRESH_RATE
}
