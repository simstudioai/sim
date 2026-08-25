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
 * This is subtracted from ledger period usage to derive "effective billable usage".
 */

import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, inArray, lt, or, sql, sum } from 'drizzle-orm'
import { DAILY_REFRESH_RATE } from '@/lib/billing/constants'
import type { BillingEntity, UsageQueryPeriod } from '@/lib/billing/core/usage-log'
import type { DbClient } from '@/lib/db/types'

const logger = createLogger('DailyRefresh')

const MS_PER_DAY = 86_400_000
const MAX_BILLING_PERIOD_DAYS = 370

interface BillingPeriodUsageWithDailyRefreshParams {
  billingEntity: BillingEntity
  billingPeriod: UsageQueryPeriod
  userIds: string[]
  refreshPeriodStart: Date
  refreshPeriodEnd?: Date | null
  planDollars: number
  seats?: number
}

/**
 * Reads the exact ledger total and the daily-refresh buckets from one snapshot.
 *
 * The two aggregates intentionally keep different predicates. Ledger totals use
 * both captured period bounds (or a reporting-time window), while refresh uses
 * the captured period start, eligible users, and per-user time bounds.
 */
export async function computeBillingPeriodUsageWithDailyRefresh(
  params: BillingPeriodUsageWithDailyRefreshParams,
  executor: DbClient = db
): Promise<{ ledgerUsage: number; refreshConsumed: number }> {
  const {
    billingEntity,
    billingPeriod,
    userIds,
    refreshPeriodStart,
    refreshPeriodEnd,
    planDollars,
    seats = 1,
  } = params
  const now = new Date()
  const cap = refreshPeriodEnd && refreshPeriodEnd < now ? refreshPeriodEnd : now
  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * seats
  const refreshUserFilters =
    cap > refreshPeriodStart
      ? [
          and(
            inArray(usageLog.userId, userIds),
            gte(usageLog.createdAt, refreshPeriodStart),
            lt(usageLog.createdAt, cap)
          ),
        ]
      : []
  const refreshFilter =
    refreshUserFilters.length > 0
      ? and(
          eq(usageLog.billingPeriodStart, refreshPeriodStart),
          refreshUserFilters.length === 1 ? refreshUserFilters[0] : or(...refreshUserFilters)
        )
      : sql<boolean>`false`
  const ledgerPeriodFilter =
    billingPeriod.source === 'reporting'
      ? and(gte(usageLog.createdAt, billingPeriod.start), lt(usageLog.createdAt, billingPeriod.end))
      : and(
          eq(usageLog.billingPeriodStart, billingPeriod.start),
          eq(usageLog.billingPeriodEnd, billingPeriod.end)
        )

  const sameCapturedPeriodStart =
    billingPeriod.source !== 'reporting' &&
    billingPeriod.start.getTime() === refreshPeriodStart.getTime()
  const reportingWindowContainsRefresh =
    billingPeriod.source === 'reporting' &&
    refreshPeriodStart >= billingPeriod.start &&
    cap <= billingPeriod.end
  const scanFilter =
    refreshUserFilters.length === 0
      ? ledgerPeriodFilter
      : sameCapturedPeriodStart
        ? eq(usageLog.billingPeriodStart, billingPeriod.start)
        : reportingWindowContainsRefresh
          ? ledgerPeriodFilter
          : or(ledgerPeriodFilter, refreshFilter)

  const rows = await executor
    .select({
      dayIndex:
        sql<number>`FLOOR((EXTRACT(EPOCH FROM ${usageLog.createdAt}) - ${Math.floor(refreshPeriodStart.getTime() / 1000)}) / 86400)`.as(
          'day_index'
        ),
      ledgerTotal:
        sql<string>`SUM(SUM(${usageLog.cost}) FILTER (WHERE ${ledgerPeriodFilter})) OVER ()`.as(
          'ledger_total'
        ),
      refreshDayTotal: sql<string>`SUM(${usageLog.cost}) FILTER (WHERE ${refreshFilter})`.as(
        'refresh_day_total'
      ),
    })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.billingEntityType, billingEntity.type),
        eq(usageLog.billingEntityId, billingEntity.id),
        scanFilter
      )
    )
    .groupBy(sql`day_index`)

  let refreshConsumed = 0
  for (const row of rows) {
    const dayUsage = Number.parseFloat(row.refreshDayTotal ?? '0')
    refreshConsumed += Math.min(dayUsage, dailyRefreshDollars)
  }

  return {
    ledgerUsage: Number.parseFloat(rows[0]?.ledgerTotal ?? '0'),
    refreshConsumed,
  }
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
    billingEntity?: { type: 'user' | 'organization'; id: string }
  },
  executor: DbClient = db
): Promise<number> {
  const { userIds, periodStart, periodEnd, planDollars, seats = 1, billingEntity } = params

  if (planDollars <= 0 || userIds.length === 0) return 0

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * seats

  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now

  if (cap <= periodStart) return 0

  const dayCount = Math.ceil((cap.getTime() - periodStart.getTime()) / MS_PER_DAY)
  if (dayCount <= 0) return 0

  const billingEntityFilter = billingEntity
    ? and(
        eq(usageLog.billingEntityType, billingEntity.type),
        eq(usageLog.billingEntityId, billingEntity.id),
        eq(usageLog.billingPeriodStart, periodStart)
      )
    : undefined

  const rowFilters = [
    and(
      inArray(usageLog.userId, userIds),
      billingEntityFilter,
      gte(usageLog.createdAt, periodStart),
      lt(usageLog.createdAt, cap)
    ),
  ]

  const rows = await executor
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
  })

  return totalConsumed
}

export async function computeOrganizationDailyRefreshConsumed(
  params: {
    organizationId: string
    periodStart: Date
    periodEnd?: Date | null
    planDollars: number
    seats?: number
  },
  executor: DbClient = db
): Promise<number> {
  const { organizationId, periodStart, periodEnd, planDollars, seats = 1 } = params
  if (planDollars <= 0) return 0

  const now = new Date()
  const cap = periodEnd && periodEnd < now ? periodEnd : now
  if (cap <= periodStart) return 0
  const dayCount = Math.ceil((cap.getTime() - periodStart.getTime()) / MS_PER_DAY)
  if (dayCount > MAX_BILLING_PERIOD_DAYS) {
    throw new Error('Organization billing period exceeds the supported annual bound')
  }

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * seats
  // Entity/period stamps fully scope the rows: every org-attributed row —
  // including a departed member's — participates in the org's refresh, and a
  // member's pre-join rows are user-stamped so they can never appear here.
  const rows = await executor
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
        eq(usageLog.billingEntityType, 'organization'),
        eq(usageLog.billingEntityId, organizationId),
        eq(usageLog.billingPeriodStart, periodStart),
        gte(usageLog.createdAt, periodStart),
        lt(usageLog.createdAt, cap)
      )
    )
    .groupBy(sql`day_index`)

  return rows.reduce((total, row) => {
    const dayUsage = Number.parseFloat(row.dayTotal ?? '0')
    return total + Math.min(dayUsage, dailyRefreshDollars)
  }, 0)
}

/**
 * Get the daily refresh allowance in dollars for a plan.
 */
export function getDailyRefreshDollars(planDollars: number): number {
  return planDollars * DAILY_REFRESH_RATE
}
