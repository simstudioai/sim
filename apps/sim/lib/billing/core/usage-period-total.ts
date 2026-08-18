import { db } from '@sim/db'
import { usageLog, usageLogPeriodTotal } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import type { DbClient, DbOrTx } from '@/lib/db/types'

const logger = createLogger('UsagePeriodTotal')

export interface BillingPeriodRange {
  start: Date
  end: Date
}

/**
 * Applies a signed delta to the running period total.
 *
 * Must run inside the same transaction as the `usage_log` mutation it accounts
 * for. The upsert is a single statement, so concurrent writers serialize on the
 * row rather than on a read-modify-write in application code, and a rolled-back
 * ledger write rolls the total back with it.
 *
 * A zero delta is skipped so a no-op flush does not manufacture a row version.
 */
export async function applyUsagePeriodTotalDelta(
  executor: DbOrTx,
  billingEntity: BillingEntity,
  billingPeriod: BillingPeriodRange,
  delta: number
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) {
    return
  }

  await executor
    .insert(usageLogPeriodTotal)
    .values({
      billingEntityType: billingEntity.type,
      billingEntityId: billingEntity.id,
      billingPeriodStart: billingPeriod.start,
      billingPeriodEnd: billingPeriod.end,
      totalCost: delta.toString(),
    })
    .onConflictDoUpdate({
      target: [
        usageLogPeriodTotal.billingEntityType,
        usageLogPeriodTotal.billingEntityId,
        usageLogPeriodTotal.billingPeriodStart,
        usageLogPeriodTotal.billingPeriodEnd,
      ],
      set: {
        totalCost: sql`${usageLogPeriodTotal.totalCost} + ${delta.toString()}::numeric`,
        updatedAt: sql`now()`,
      },
    })
}

/**
 * Reads the maintained period total.
 *
 * Returns `null` when no row exists yet, which is distinct from a total of
 * zero: it means this (entity, period) has not been written since the rollup
 * began being maintained, so the caller must fall back to aggregating the
 * ledger rather than reporting no usage.
 */
export async function readUsagePeriodTotal(
  billingEntity: BillingEntity,
  billingPeriod: BillingPeriodRange,
  executor: DbClient = db
): Promise<number | null> {
  const [row] = await executor
    .select({ totalCost: usageLogPeriodTotal.totalCost })
    .from(usageLogPeriodTotal)
    .where(
      and(
        eq(usageLogPeriodTotal.billingEntityType, billingEntity.type),
        eq(usageLogPeriodTotal.billingEntityId, billingEntity.id),
        eq(usageLogPeriodTotal.billingPeriodStart, billingPeriod.start),
        eq(usageLogPeriodTotal.billingPeriodEnd, billingPeriod.end)
      )
    )
    .limit(1)

  if (!row) {
    return null
  }
  return Number.parseFloat(row.totalCost)
}

/**
 * Recomputes period totals from the ledger, which stays the source of truth.
 *
 * The rollup is maintained transactionally and so should never drift, but it is
 * a derived billing number — this exists so drift is always recoverable rather
 * than permanent, and so the table can be populated for periods that predate
 * the rollup without a migration-time backfill (which would have raced the
 * deploy: between the migration and the new image being live, the old code
 * writes ledger rows without maintaining the rollup, leaving a stale base that
 * every later increment would build on).
 *
 * Writes absolute totals, so it is idempotent and safe to re-run.
 *
 * The one drift source that is not transactional is `usage_log.user_id`'s
 * `ON DELETE CASCADE`: deleting a user removes their ledger rows without
 * lowering the rollup, leaving it over-counted for any period they contributed
 * to. Run this after a user deletion, and on a schedule as a backstop.
 */
export async function reconcileUsagePeriodTotals(options?: {
  /** Only reconcile periods that end at or after this instant. */
  periodEndsAfter?: Date
  executor?: DbClient
}): Promise<{ periodsReconciled: number }> {
  const executor = options?.executor ?? db
  const periodEndsAfter = options?.periodEndsAfter

  const result = await executor.execute(sql`
    insert into ${usageLogPeriodTotal} (
      billing_entity_type,
      billing_entity_id,
      billing_period_start,
      billing_period_end,
      total_cost,
      updated_at
    )
    select
      ${usageLog.billingEntityType},
      ${usageLog.billingEntityId},
      ${usageLog.billingPeriodStart},
      ${usageLog.billingPeriodEnd},
      coalesce(sum(${usageLog.cost}), 0),
      now()
    from ${usageLog}
    where ${usageLog.billingEntityType} is not null
      ${periodEndsAfter ? sql`and ${usageLog.billingPeriodEnd} >= ${periodEndsAfter}` : sql``}
    group by
      ${usageLog.billingEntityType},
      ${usageLog.billingEntityId},
      ${usageLog.billingPeriodStart},
      ${usageLog.billingPeriodEnd}
    on conflict (
      billing_entity_type,
      billing_entity_id,
      billing_period_start,
      billing_period_end
    ) do update set
      total_cost = excluded.total_cost,
      updated_at = now()
    returning 1
  `)

  const periodsReconciled = Array.isArray(result) ? result.length : 0
  logger.info('Reconciled usage period totals', { periodsReconciled, periodEndsAfter })
  return { periodsReconciled }
}
